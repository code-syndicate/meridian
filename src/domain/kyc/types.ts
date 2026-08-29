export type KycStep =
  | "identity"
  | "government_id"
  | "address"
  | "document"
  | "disclosures"
  | "done"

export type KycStatus =
  | "draft"
  | "submitted"
  | "in_review"
  | "approved"
  | "rejected"
  | "expired"

export type GovernmentIdType = "BVN" | "NIN"

export type ConsentDocument = "terms" | "privacy" | "risk" | "aml"

export class KycError extends Error {
  constructor(
    readonly field: string,
    message: string,
  ) {
    super(message)
    this.name = "KycError"
  }
}
