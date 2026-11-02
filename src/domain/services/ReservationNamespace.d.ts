import ReservationCursor from '../value-objects/ReservationCursor.js';

export type ReservationPhase = 'reserved' | 'prepared' | 'armed' | 'settled' | 'cancelled';
export type ReservationIdentity = { readonly key: string; readonly binding: string };
export type ReservationCapacity = { readonly unit: 'record-slot'; readonly limit: number };
export type ReservationPolicy = ReservationCapacity & { readonly namespace: string };
export type ReservationRecordView = ReservationIdentity & {
  readonly phase: ReservationPhase;
  readonly preparation: string | null;
  readonly settlement: string | null;
  readonly charge: 0 | 1;
};
export type ReservationEvidenceInput = {
  readonly record: Uint8Array;
  readonly supports?: readonly { readonly type: 'blob' | 'tree'; readonly oid: string }[];
  readonly parents?: readonly string[];
};
export type ReservationRoots = {
  readonly supports: readonly { readonly type: 'blob' | 'tree'; readonly oid: string }[];
  readonly parents: readonly string[];
};
export type ReservationCustodyView = {
  readonly revision: string;
  readonly descriptor: ReservationIdentity & {
    readonly namespace: string;
    readonly stage: 'preparation' | 'settlement';
    readonly recordOid: string;
    readonly roots: ReservationRoots;
    readonly preparation: string | null;
    readonly parents: readonly string[];
  };
};
export type ReservationRefusalReason =
  | 'capacity-full' | 'binding-conflict' | 'cancelled' | 'policy-mismatch' | 'contention'
  | 'not-reserved' | 'not-prepared' | 'not-settled' | 'already-armed' | 'already-settled'
  | 'irreversible' | 'preparation-mismatch' | 'settlement-mismatch';
export type ReservationRefused = ReservationIdentity & {
  readonly status: 'refused';
  readonly reason: ReservationRefusalReason;
};
export type ReservationIndeterminate = ReservationIdentity & {
  readonly status: 'indeterminate';
  readonly cause: Error;
};
export type ReservationAcknowledgedStatus = 'admitted' | 'recovered' | 'prepared' | 'armed' | 'settled' | 'cancelled';
export type ReservationAcknowledgement<S extends ReservationAcknowledgedStatus = ReservationAcknowledgedStatus> = {
  readonly status: S;
  readonly record: ReservationRecordView;
  readonly revision: string;
};
export type ReservationOutcome<S extends ReservationAcknowledgedStatus = ReservationAcknowledgedStatus> = ReservationAcknowledgement<S> | ReservationRefused | ReservationIndeterminate;
export type ReservationInspection = {
  readonly status: 'inspected';
  readonly record: ReservationRecordView;
  readonly revision: string;
  readonly policy: ReservationPolicy;
  readonly charged: number;
  /** Observed after the ledger; the two refs are not an atomic snapshot. */
  readonly custody: ReservationCustodyView | null;
};
export type ReservationEvidenceRead = {
  readonly status: 'read';
  readonly attempt: ReservationRecordView;
  readonly ledgerRevision: string;
  readonly stage: 'preparation' | 'settlement';
  readonly custodyRevision: string;
  readonly evidence: {
    /** A fresh byte copy on every access. */
    readonly record: Uint8Array;
    readonly roots: ReservationRoots;
  };
};
export type ReservationCursorData = {
  readonly namespace: string;
  readonly revision: string;
  readonly after: string;
  readonly phase?: ReservationPhase | null;
};
export type ReservationListOptions = {
  readonly cursor?: ReservationCursorData | null;
  readonly phase?: ReservationPhase | null;
  /** 1–100; default100. */
  readonly limit?: number;
  /** 129–8192 index objects, including seek; default1024. */
  readonly nodeBudget?: number;
};
export type ReservationPage = {
  readonly status: 'page';
  readonly policy: ReservationPolicy;
  readonly charged: number;
  readonly revision: string;
  /** Ledger claims at this snapshot, without a live per-record custody check. */
  readonly records: readonly ReservationRecordView[];
  readonly visitedNodes: number;
  readonly next: ReservationCursor | null;
};
export type ReservationListUnavailable = {
  readonly status: 'unavailable';
  readonly namespace: string;
  readonly cursor: ReservationCursor | null;
  readonly cause: Error;
};
export type ReservationOpenRefusal = {
  readonly status: 'refused';
  readonly policy: ReservationPolicy;
  readonly reason: 'policy-mismatch' | 'contention';
};
export type ReservationOpenIndeterminate = {
  readonly status: 'indeterminate';
  readonly policy: ReservationPolicy;
  readonly cause: Error;
};
export type ReservationOpenOutcome = ReservationNamespace | ReservationOpenRefusal | ReservationOpenIndeterminate;
export type ReservationCapability = {
  open(options: { readonly namespace: string; readonly capacity: ReservationCapacity }): Promise<ReservationOpenOutcome>;
};

/** Only a fresh `arm()` result with status `armed` permits an external effect. */
export default class ReservationNamespace {
  private constructor();
  readonly status: 'opened';
  readonly namespace: string;
  readonly policy: ReservationPolicy;
  readonly openedRevision: string;
  reserve(identity: ReservationIdentity): Promise<ReservationOutcome<'admitted' | 'recovered'>>;
  prepare(options: ReservationIdentity & { readonly evidence: ReservationEvidenceInput }): Promise<ReservationOutcome<'prepared' | 'recovered'>>;
  arm(identity: ReservationIdentity): Promise<ReservationOutcome<'armed'>>;
  settle(options: ReservationIdentity & { readonly evidence: ReservationEvidenceInput }): Promise<ReservationOutcome<'settled' | 'recovered'>>;
  cancel(identity: ReservationIdentity): Promise<ReservationOutcome<'cancelled'>>;
  /** Completes storage phases or cancelled cleanup; never arms or executes effects. */
  reconcile(identity: ReservationIdentity): Promise<ReservationOutcome<'prepared' | 'settled' | 'cancelled' | 'recovered'>>;
  inspect(identity: ReservationIdentity): Promise<ReservationInspection | ReservationRefused | ReservationIndeterminate>;
  readEvidence(options: ReservationIdentity & { readonly stage: 'preparation' | 'settlement' }): Promise<ReservationEvidenceRead | ReservationRefused | ReservationIndeterminate>;
  list(options?: ReservationListOptions): Promise<ReservationPage | ReservationListUnavailable>;
}
