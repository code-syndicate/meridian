import express from "express"
import type { Config } from "../config"
import type { AuditRepository } from "../db/repositories/audit"
import type { KycRepository, KycProfile } from "../db/repositories/kyc"
import type { KycProvider } from "../services/kyc-provider"
import {
  validateName,
  validateDateOfBirth,
  normalizePhone,
  validateGovernmentId,
  validateCountry,
  validateRegion,
  idLabel,
} from "../domain/kyc/validate"
import { COUNTRIES } from "../domain/kyc/countries"
import { canEnter, nextStep, stepIndex } from "../domain/kyc/steps"
import { KycError, type ConsentDocument, type GovernmentIdType } from "../domain/kyc/types"
import { requireAuth } from "../middleware/session"

export interface OnboardingDeps {
  kyc: KycRepository
  audit: AuditRepository
  provider: KycProvider
  config: Config
}

/**
 * Bump when any legal document changes. Consent is recorded against this, so
 * a user who agreed to an older version is visibly on the older version.
 */
export const DOCUMENT_VERSION = "2026-08-29"

const CONSENT_DOCUMENTS: ConsentDocument[] = ["terms", "privacy", "risk", "aml"]

const STEP_PATHS: Record<string, string> = {
  identity: "/onboarding/identity",
  government_id: "/onboarding/government-id",
  address: "/onboarding/address",
  document: "/onboarding/document",
  disclosures: "/onboarding/disclosures",
  done: "/onboarding/submitted",
}

export function createOnboardingRoutes(deps: OnboardingDeps): express.Router {
  const router = express.Router()
  router.use("/onboarding", requireAuth())

  /**
   * Loads the open application, creating one on first arrival. Returns null
   * after redirecting when the requested step is ahead of the user's saved
   * progress, so a URL cannot skip verification.
   */
  async function gate(
    req: express.Request,
    res: express.Response,
    step: Parameters<typeof canEnter>[0],
  ): Promise<{ id: number; profile: KycProfile; current: string } | null> {
    const user = req.user!
    let application = await deps.kyc.openFor(user.id)

    if (!application) {
      const id = await deps.kyc.start(user.id, 2)
      await deps.audit.record({
        userId: user.id,
        actorType: "user",
        action: "kyc.started",
        ip: req.ip ?? null,
        userAgent: req.get("user-agent") ?? null,
      })
      application = (await deps.kyc.openFor(user.id))!
      void id
    }

    if (application.status !== "draft") {
      res.redirect(303, "/account/verification")
      return null
    }

    if (!canEnter(step, application.currentStep)) {
      res.redirect(303, STEP_PATHS[application.currentStep]!)
      return null
    }

    return {
      id: application.id,
      profile: (await deps.kyc.profileFor(application.id))!,
      current: application.currentStep,
    }
  }

  function stepLocals(step: string) {
    return { stepNumber: stepIndex(step as never) + 1, stepTotal: 5 }
  }

  router.get("/onboarding", async (req, res) => {
    const user = req.user!
    let application = await deps.kyc.openFor(user.id)

    if (application && application.status !== "draft") {
      return res.redirect(303, "/account/verification")
    }

    // This is the entry point, so it starts the application rather than
    // leaving that to whichever step template happens to load first.
    if (!application) {
      await deps.kyc.start(user.id, 2)
      await deps.audit.record({
        userId: user.id,
        actorType: "user",
        action: "kyc.started",
        ip: req.ip ?? null,
        userAgent: req.get("user-agent") ?? null,
      })
      application = (await deps.kyc.openFor(user.id))!
    }

    res.redirect(303, STEP_PATHS[application.currentStep]!)
  })

  // Step 1: identity
  router.get("/onboarding/identity", async (req, res) => {
    const state = await gate(req, res, "identity")
    if (!state) return
    res.render("onboarding/identity", {
      title: "Verify your identity | Meridian",
      description: "Step one of identity verification.",
      path: req.path,
      ...stepLocals("identity"),
      errors: {},
      values: {
        firstName: state.profile.firstName ?? "",
        middleName: state.profile.middleName ?? "",
        lastName: state.profile.lastName ?? "",
        dateOfBirth: state.profile.dateOfBirth ?? "",
        phone: state.profile.phone ?? "",
      },
    })
  })

  router.post("/onboarding/identity", async (req, res) => {
    const state = await gate(req, res, "identity")
    if (!state) return
    const body = req.body as Record<string, string | undefined>
    const values = {
      firstName: String(body.firstName ?? ""),
      middleName: String(body.middleName ?? ""),
      lastName: String(body.lastName ?? ""),
      dateOfBirth: String(body.dateOfBirth ?? ""),
      phone: String(body.phone ?? ""),
    }

    const errors: Record<string, string> = {}
    const patch: Partial<KycProfile> = {}

    for (const [field, required] of [
      ["firstName", true],
      ["middleName", false],
      ["lastName", true],
    ] as const) {
      const raw = values[field]
      if (!required && raw.trim() === "") {
        patch[field] = null
        continue
      }
      try {
        patch[field] = validateName(raw, field)
      } catch (error) {
        if (error instanceof KycError) errors[field] = error.message
        else throw error
      }
    }

    try {
      patch.dateOfBirth = validateDateOfBirth(values.dateOfBirth)
    } catch (error) {
      if (error instanceof KycError) errors.dateOfBirth = error.message
      else throw error
    }

    try {
      patch.phone = normalizePhone(values.phone)
    } catch (error) {
      if (error instanceof KycError) errors.phone = error.message
      else throw error
    }

    if (Object.keys(errors).length > 0) {
      return res.status(400).render("onboarding/identity", {
        title: "Verify your identity | Meridian",
        description: "Step one of identity verification.",
        path: "/onboarding/identity",
        ...stepLocals("identity"),
        errors,
        values,
      })
    }

    await deps.kyc.updateProfile(state.id, patch)
    if (state.current === "identity") await deps.kyc.advance(state.id, nextStep("identity"))
    await deps.audit.record({
      userId: req.user!.id,
      actorType: "user",
      action: "kyc.step_completed",
      target: "identity",
      ip: req.ip ?? null,
    })
    res.redirect(303, STEP_PATHS.government_id!)
  })

  // Step 2: government id
  router.get("/onboarding/government-id", async (req, res) => {
    const state = await gate(req, res, "government_id")
    if (!state) return
    res.render("onboarding/government-id", {
      title: "Government ID | Meridian",
      description: "Step two of identity verification.",
      path: req.path,
      ...stepLocals("government_id"),
      errors: {},
      idType: state.profile.governmentIdType ?? "PASSPORT",
      idLabel: idLabel(state.profile.governmentIdType ?? "PASSPORT"),
      last4: state.profile.governmentIdLast4,
    })
  })

  router.post("/onboarding/government-id", async (req, res) => {
    const state = await gate(req, res, "government_id")
    if (!state) return
    const body = req.body as Record<string, string | undefined>
    const requested = String(body.idType ?? "")
    const idType = (
      requested === "NATIONAL_ID" || requested === "DRIVERS_LICENSE" ? requested : "PASSPORT"
    ) as GovernmentIdType

    const render = (errors: Record<string, string>, status: number): void => {
      res.status(status).render("onboarding/government-id", {
        title: "Government ID | Meridian",
        description: "Step two of identity verification.",
        path: "/onboarding/government-id",
        ...stepLocals("government_id"),
        errors,
        idType,
        idLabel: idLabel(idType),
        last4: state.profile.governmentIdLast4,
      })
    }

    let idNumber: string
    try {
      idNumber = validateGovernmentId(idType, String(body.idNumber ?? ""))
    } catch (error) {
      if (error instanceof KycError) return render({ governmentId: error.message }, 400)
      throw error
    }

    const result = await deps.provider.verifyGovernmentId({
      idType,
      idNumber,
      firstName: state.profile.firstName ?? "",
      lastName: state.profile.lastName ?? "",
      dateOfBirth: state.profile.dateOfBirth ?? "",
    })

    await deps.kyc.setProvider(state.id, deps.provider.name, result.reference)

    if (!result.verified) {
      await deps.audit.record({
        userId: req.user!.id,
        actorType: "user",
        action: "kyc.government_id_failed",
        target: idType,
        ip: req.ip ?? null,
      })
      return render(
        { governmentId: result.reason ?? "We could not verify that identifier." },
        400,
      )
    }

    // Only the last four digits are retained. The full value stays in this
    // request and is never written anywhere.
    await deps.kyc.updateProfile(state.id, {
      governmentIdType: idType,
      governmentIdLast4: idNumber.slice(-4),
      providerReference: result.reference,
    })
    if (state.current === "government_id") await deps.kyc.advance(state.id, nextStep("government_id"))
    await deps.audit.record({
      userId: req.user!.id,
      actorType: "user",
      action: "kyc.step_completed",
      target: "government_id",
      ip: req.ip ?? null,
    })
    res.redirect(303, STEP_PATHS.address!)
  })

  // Step 3: address
  router.get("/onboarding/address", async (req, res) => {
    const state = await gate(req, res, "address")
    if (!state) return
    res.render("onboarding/address", {
      title: "Your address | Meridian",
      description: "Step three of identity verification.",
      path: req.path,
      ...stepLocals("address"),
      errors: {},
      countries: COUNTRIES,
      values: {
        country: state.profile.country ?? "",
        region: state.profile.region ?? "",
        city: state.profile.city ?? "",
        streetAddress: state.profile.streetAddress ?? "",
        postalCode: state.profile.postalCode ?? "",
      },
    })
  })

  router.post("/onboarding/address", async (req, res) => {
    const state = await gate(req, res, "address")
    if (!state) return
    const body = req.body as Record<string, string | undefined>
    const values = {
      country: String(body.country ?? ""),
      region: String(body.region ?? "").trim(),
      city: String(body.city ?? "").trim(),
      streetAddress: String(body.streetAddress ?? "").trim(),
      postalCode: String(body.postalCode ?? "").trim(),
    }

    const errors: Record<string, string> = {}
    for (const [fn, field] of [
      [() => validateCountry(values.country), "country"],
      [() => validateRegion(values.region), "region"],
    ] as const) {
      try {
        fn()
      } catch (error) {
        if (error instanceof KycError) errors[field] = error.message
        else throw error
      }
    }
    if (values.city.length === 0) errors.city = "Enter your city or town"
    if (values.streetAddress.length < 5) {
      errors.streetAddress = "Enter your full street address"
    }

    if (Object.keys(errors).length > 0) {
      return res.status(400).render("onboarding/address", {
        title: "Your address | Meridian",
        description: "Step three of identity verification.",
        path: "/onboarding/address",
        ...stepLocals("address"),
        errors,
        countries: COUNTRIES,
        values,
      })
    }

    await deps.kyc.updateProfile(state.id, {
      country: values.country,
      region: values.region,
      city: values.city,
      streetAddress: values.streetAddress,
      postalCode: values.postalCode || null,
    })
    if (state.current === "address") await deps.kyc.advance(state.id, nextStep("address"))
    await deps.audit.record({
      userId: req.user!.id,
      actorType: "user",
      action: "kyc.step_completed",
      target: "address",
      ip: req.ip ?? null,
    })
    res.redirect(303, STEP_PATHS.document!)
  })

  // Step 4: document and liveness, handled entirely by the provider
  router.get("/onboarding/document", async (req, res) => {
    const state = await gate(req, res, "document")
    if (!state) return

    const application = (await deps.kyc.openFor(req.user!.id))!
    let sessionId = application.documentSession
    let status: "pending" | "passed" | "failed" = "pending"
    let reason: string | undefined

    if (sessionId) {
      const result = await deps.provider.getDocumentResult(sessionId)
      status = result.status
      reason = result.reason
    }

    if (status === "passed") {
      if (state.current === "document") await deps.kyc.advance(state.id, nextStep("document"))
      await deps.audit.record({
        userId: req.user!.id,
        actorType: "user",
        action: "kyc.step_completed",
        target: "document",
        ip: req.ip ?? null,
      })
      return res.redirect(303, STEP_PATHS.disclosures!)
    }

    if (!sessionId || status === "failed") {
      const session = await deps.provider.createDocumentSession({
        applicationId: state.id,
        redirectUrl: "/onboarding/document",
      })
      await deps.kyc.setDocumentSession(state.id, session.sessionId)
      sessionId = session.sessionId
      res.render("onboarding/document", {
        title: "Photo ID and selfie | Meridian",
        description: "Step four of identity verification.",
        path: "/onboarding/document",
        ...stepLocals("document"),
        sessionUrl: session.url,
        error: status === "failed" ? reason : null,
      })
      return
    }

    res.render("onboarding/document", {
      title: "Photo ID and selfie | Meridian",
      description: "Step four of identity verification.",
      path: "/onboarding/document",
      ...stepLocals("document"),
      sessionUrl: `/onboarding/document/sandbox?session=${encodeURIComponent(sessionId)}`,
      error: null,
    })
  })

  // Step 5: disclosures
  router.get("/onboarding/disclosures", async (req, res) => {
    const state = await gate(req, res, "disclosures")
    if (!state) return
    res.render("onboarding/disclosures", {
      title: "Disclosures | Meridian",
      description: "Step five of identity verification.",
      path: req.path,
      ...stepLocals("disclosures"),
      error: null,
      version: DOCUMENT_VERSION,
    })
  })

  router.post("/onboarding/disclosures", async (req, res) => {
    const state = await gate(req, res, "disclosures")
    if (!state) return
    const body = req.body as Record<string, string | undefined>

    // All four, separately. Nothing is pre-ticked and nothing is bundled.
    const missing = CONSENT_DOCUMENTS.filter((doc) => body[doc] !== "on")
    if (missing.length > 0) {
      return res.status(400).render("onboarding/disclosures", {
        title: "Disclosures | Meridian",
        description: "Step five of identity verification.",
        path: "/onboarding/disclosures",
        ...stepLocals("disclosures"),
        error: "Tick every box to continue. Each one is a separate agreement.",
        version: DOCUMENT_VERSION,
      })
    }

    for (const document of CONSENT_DOCUMENTS) {
      await deps.kyc.recordConsent(state.id, document, DOCUMENT_VERSION, req.ip ?? null)
    }
    await deps.kyc.submit(state.id)
    await deps.audit.record({
      userId: req.user!.id,
      actorType: "user",
      action: "kyc.submitted",
      ip: req.ip ?? null,
      metadata: { documentVersion: DOCUMENT_VERSION },
    })
    res.flash("Your verification has been submitted.")
    res.redirect(303, "/onboarding/submitted")
  })

  router.get("/onboarding/submitted", async (req, res) => {
    res.render("onboarding/submitted", {
      title: "Verification submitted | Meridian",
      description: "Your verification is with our reviewers.",
      path: req.path,
    })
  })

  return router
}
