import type { Client, Executor, Tx } from "../index"
import { all, get, run, withTransaction } from "../index"
import type {
  ConsentDocument,
  GovernmentIdType,
  KycStatus,
  KycStep,
} from "../../domain/kyc/types"

export interface KycApplication {
  id: number
  userId: number
  status: KycStatus
  currentStep: KycStep
  targetTier: number
  provider: string | null
  providerRef: string | null
  documentSession: string | null
  rejectionReason: string | null
  submittedAt: string | null
  decidedAt: string | null
}

export interface KycProfile {
  firstName: string | null
  middleName: string | null
  lastName: string | null
  dateOfBirth: string | null
  phone: string | null
  phoneVerifiedAt: string | null
  governmentIdType: GovernmentIdType | null
  governmentIdLast4: string | null
  providerReference: string | null
  country: string | null
  region: string | null
  city: string | null
  streetAddress: string | null
  postalCode: string | null
}

interface ApplicationRow {
  id: number
  user_id: number
  status: KycStatus
  current_step: KycStep
  target_tier: number
  provider: string | null
  provider_ref: string | null
  document_session: string | null
  rejection_reason: string | null
  submitted_at: string | null
  decided_at: string | null
}

interface ProfileRow {
  first_name: string | null
  middle_name: string | null
  last_name: string | null
  date_of_birth: string | null
  phone: string | null
  phone_verified_at: string | null
  government_id_type: GovernmentIdType | null
  government_id_last4: string | null
  provider_reference: string | null
  country: string | null
  region: string | null
  city: string | null
  street_address: string | null
  postal_code: string | null
}

const APPLICATION_COLUMNS = `id, user_id, status, current_step, target_tier, provider,
  provider_ref, document_session, rejection_reason, submitted_at, decided_at`

const OPEN_STATUSES = "('draft', 'submitted', 'in_review', 'approved')"

// Allowlist. A patch key that is not here cannot reach the SET clause.
const PROFILE_COLUMNS: Record<keyof KycProfile, string> = {
  firstName: "first_name",
  middleName: "middle_name",
  lastName: "last_name",
  dateOfBirth: "date_of_birth",
  phone: "phone",
  phoneVerifiedAt: "phone_verified_at",
  governmentIdType: "government_id_type",
  governmentIdLast4: "government_id_last4",
  providerReference: "provider_reference",
  country: "country",
  region: "region",
  city: "city",
  streetAddress: "street_address",
  postalCode: "postal_code",
}

function toApplication(row: ApplicationRow): KycApplication {
  return {
    id: row.id,
    userId: row.user_id,
    status: row.status,
    currentStep: row.current_step,
    targetTier: row.target_tier,
    provider: row.provider,
    providerRef: row.provider_ref,
    documentSession: row.document_session,
    rejectionReason: row.rejection_reason,
    submittedAt: row.submitted_at,
    decidedAt: row.decided_at,
  }
}

function toProfile(row: ProfileRow): KycProfile {
  return {
    firstName: row.first_name,
    middleName: row.middle_name,
    lastName: row.last_name,
    dateOfBirth: row.date_of_birth,
    phone: row.phone,
    phoneVerifiedAt: row.phone_verified_at,
    governmentIdType: row.government_id_type,
    governmentIdLast4: row.government_id_last4,
    providerReference: row.provider_reference,
    country: row.country,
    region: row.region,
    city: row.city,
    streetAddress: row.street_address,
    postalCode: row.postal_code,
  }
}

export class KycRepository {
  constructor(private readonly db: Client) {}

  async start(userId: number, targetTier: 1 | 2, ex: Tx = this.db): Promise<number> {
    const now = new Date().toISOString()
    return withTransaction(ex, async (tx) => {
      const inserted = await run(
        tx,
        `INSERT INTO kyc_applications
           (user_id, status, current_step, target_tier, created_at, updated_at)
         VALUES (?, 'draft', 'identity', ?, ?, ?)`,
        [userId, targetTier, now, now],
      )
      const id = Number(inserted.lastInsertRowid)
      // A profile always exists for an application, so every later read is
      // a plain update rather than an upsert.
      await run(
        tx,
        "INSERT INTO kyc_profiles (application_id, created_at, updated_at) VALUES (?, ?, ?)",
        [id, now, now],
      )
      return id
    })
  }

  async openFor(userId: number, ex: Executor = this.db): Promise<KycApplication | null> {
    const row = await get<ApplicationRow>(
      ex,
      `SELECT ${APPLICATION_COLUMNS} FROM kyc_applications
       WHERE user_id = ? AND status IN ${OPEN_STATUSES}`,
      [userId],
    )
    return row ? toApplication(row) : null
  }

  async latestFor(userId: number, ex: Executor = this.db): Promise<KycApplication | null> {
    const row = await get<ApplicationRow>(
      ex,
      `SELECT ${APPLICATION_COLUMNS} FROM kyc_applications
       WHERE user_id = ? ORDER BY id DESC LIMIT 1`,
      [userId],
    )
    return row ? toApplication(row) : null
  }

  async attemptsFor(userId: number, ex: Executor = this.db): Promise<number> {
    const row = await get<{ n: number }>(
      ex,
      "SELECT COUNT(*) AS n FROM kyc_applications WHERE user_id = ?",
      [userId],
    )
    return Number(row!.n)
  }

  async profileFor(applicationId: number, ex: Executor = this.db): Promise<KycProfile | null> {
    const row = await get<ProfileRow>(
      ex,
      `SELECT first_name, middle_name, last_name, date_of_birth, phone, phone_verified_at,
              government_id_type, government_id_last4, provider_reference,
              country, region, city, street_address, postal_code
       FROM kyc_profiles WHERE application_id = ?`,
      [applicationId],
    )
    return row ? toProfile(row) : null
  }

  async updateProfile(
    applicationId: number,
    patch: Partial<KycProfile>,
    ex: Executor = this.db,
  ): Promise<void> {
    const entries = Object.entries(patch).filter(([key]) => key in PROFILE_COLUMNS)
    if (entries.length === 0) return
    const assignments = entries
      .map(([key]) => `${PROFILE_COLUMNS[key as keyof KycProfile]} = ?`)
      .join(", ")
    await run(
      ex,
      `UPDATE kyc_profiles SET ${assignments}, updated_at = ? WHERE application_id = ?`,
      [
        ...entries.map(([, value]) => (value as string | null) ?? null),
        new Date().toISOString(),
        applicationId,
      ],
    )
  }

  async advance(applicationId: number, step: KycStep, ex: Executor = this.db): Promise<void> {
    await run(ex, "UPDATE kyc_applications SET current_step = ?, updated_at = ? WHERE id = ?", [
      step,
      new Date().toISOString(),
      applicationId,
    ])
  }

  async setProvider(
    applicationId: number,
    provider: string,
    reference: string,
    ex: Executor = this.db,
  ): Promise<void> {
    await run(
      ex,
      "UPDATE kyc_applications SET provider = ?, provider_ref = ?, updated_at = ? WHERE id = ?",
      [provider, reference, new Date().toISOString(), applicationId],
    )
  }

  async setDocumentSession(
    applicationId: number,
    sessionId: string,
    ex: Executor = this.db,
  ): Promise<void> {
    await run(
      ex,
      "UPDATE kyc_applications SET document_session = ?, updated_at = ? WHERE id = ?",
      [sessionId, new Date().toISOString(), applicationId],
    )
  }

  async recordConsent(
    applicationId: number,
    document: ConsentDocument,
    version: string,
    ip: string | null,
    ex: Executor = this.db,
  ): Promise<void> {
    await run(
      ex,
      `INSERT INTO kyc_consents (application_id, document, version, ip, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [applicationId, document, version, ip, new Date().toISOString()],
    )
  }

  async consentsFor(applicationId: number, ex: Executor = this.db): Promise<ConsentDocument[]> {
    const rows = await all<{ document: ConsentDocument }>(
      ex,
      "SELECT DISTINCT document FROM kyc_consents WHERE application_id = ?",
      [applicationId],
    )
    return rows.map((row) => row.document)
  }

  async submit(applicationId: number, ex: Executor = this.db): Promise<void> {
    const now = new Date().toISOString()
    await run(
      ex,
      `UPDATE kyc_applications SET status = 'in_review', current_step = 'done',
         submitted_at = ?, updated_at = ? WHERE id = ?`,
      [now, now, applicationId],
    )
  }

  async decide(
    applicationId: number,
    status: KycStatus,
    reason?: string,
    ex: Executor = this.db,
  ): Promise<void> {
    const now = new Date().toISOString()
    await run(
      ex,
      `UPDATE kyc_applications SET status = ?, rejection_reason = ?, decided_at = ?,
         updated_at = ? WHERE id = ?`,
      [status, reason ?? null, now, now, applicationId],
    )
  }
}
