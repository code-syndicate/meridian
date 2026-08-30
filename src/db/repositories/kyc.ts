import type { Database } from "bun:sqlite"
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
  constructor(private readonly db: Database) {}

  start(userId: number, targetTier: 1 | 2): number {
    const now = new Date().toISOString()
    return this.db.transaction(() => {
      this.db
        .query(
          `INSERT INTO kyc_applications
             (user_id, status, current_step, target_tier, created_at, updated_at)
           VALUES (?, 'draft', 'identity', ?, ?, ?)`,
        )
        .run(userId, targetTier, now, now)
      const id = Number(
        this.db.query<{ id: number }, []>("SELECT last_insert_rowid() AS id").get()!.id,
      )
      // A profile always exists for an application, so every later read is
      // a plain update rather than an upsert.
      this.db
        .query(
          "INSERT INTO kyc_profiles (application_id, created_at, updated_at) VALUES (?, ?, ?)",
        )
        .run(id, now, now)
      return id
    })()
  }

  openFor(userId: number): KycApplication | null {
    const row = this.db
      .query<ApplicationRow, [number]>(
        `SELECT ${APPLICATION_COLUMNS} FROM kyc_applications
         WHERE user_id = ? AND status IN ${OPEN_STATUSES}`,
      )
      .get(userId)
    return row ? toApplication(row) : null
  }

  latestFor(userId: number): KycApplication | null {
    const row = this.db
      .query<ApplicationRow, [number]>(
        `SELECT ${APPLICATION_COLUMNS} FROM kyc_applications
         WHERE user_id = ? ORDER BY id DESC LIMIT 1`,
      )
      .get(userId)
    return row ? toApplication(row) : null
  }

  attemptsFor(userId: number): number {
    return Number(
      this.db
        .query<{ n: number }, [number]>(
          "SELECT COUNT(*) AS n FROM kyc_applications WHERE user_id = ?",
        )
        .get(userId)!.n,
    )
  }

  profileFor(applicationId: number): KycProfile | null {
    const row = this.db
      .query<ProfileRow, [number]>(
        `SELECT first_name, middle_name, last_name, date_of_birth, phone, phone_verified_at,
                government_id_type, government_id_last4, provider_reference,
                country, region, city, street_address, postal_code
         FROM kyc_profiles WHERE application_id = ?`,
      )
      .get(applicationId)
    return row ? toProfile(row) : null
  }

  updateProfile(applicationId: number, patch: Partial<KycProfile>): void {
    const entries = Object.entries(patch).filter(([key]) => key in PROFILE_COLUMNS)
    if (entries.length === 0) return
    const assignments = entries
      .map(([key]) => `${PROFILE_COLUMNS[key as keyof KycProfile]} = ?`)
      .join(", ")
    this.db
      .query(`UPDATE kyc_profiles SET ${assignments}, updated_at = ? WHERE application_id = ?`)
      .run(
        ...entries.map(([, value]) => (value as string | null) ?? null),
        new Date().toISOString(),
        applicationId,
      )
  }

  advance(applicationId: number, step: KycStep): void {
    this.db
      .query("UPDATE kyc_applications SET current_step = ?, updated_at = ? WHERE id = ?")
      .run(step, new Date().toISOString(), applicationId)
  }

  setProvider(applicationId: number, provider: string, reference: string): void {
    this.db
      .query(
        "UPDATE kyc_applications SET provider = ?, provider_ref = ?, updated_at = ? WHERE id = ?",
      )
      .run(provider, reference, new Date().toISOString(), applicationId)
  }

  setDocumentSession(applicationId: number, sessionId: string): void {
    this.db
      .query("UPDATE kyc_applications SET document_session = ?, updated_at = ? WHERE id = ?")
      .run(sessionId, new Date().toISOString(), applicationId)
  }

  recordConsent(
    applicationId: number,
    document: ConsentDocument,
    version: string,
    ip: string | null,
  ): void {
    this.db
      .query(
        `INSERT INTO kyc_consents (application_id, document, version, ip, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(applicationId, document, version, ip, new Date().toISOString())
  }

  consentsFor(applicationId: number): ConsentDocument[] {
    return this.db
      .query<{ document: ConsentDocument }, [number]>(
        "SELECT DISTINCT document FROM kyc_consents WHERE application_id = ?",
      )
      .all(applicationId)
      .map((row) => row.document)
  }

  submit(applicationId: number): void {
    const now = new Date().toISOString()
    this.db
      .query(
        `UPDATE kyc_applications SET status = 'in_review', current_step = 'done',
           submitted_at = ?, updated_at = ? WHERE id = ?`,
      )
      .run(now, now, applicationId)
  }

  decide(applicationId: number, status: KycStatus, reason?: string): void {
    const now = new Date().toISOString()
    this.db
      .query(
        `UPDATE kyc_applications SET status = ?, rejection_reason = ?, decided_at = ?,
           updated_at = ? WHERE id = ?`,
      )
      .run(status, reason ?? null, now, now, applicationId)
  }
}
