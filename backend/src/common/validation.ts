import { Matches } from 'class-validator';

/** = WBS-3 `Identifier` (document-contract.md §1). Anything else is rejected before any query. */
export const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_.:\-]{0,127}$/;

export namespace IdParam {
  export class Course {
    @Matches(IDENTIFIER) courseId!: string;
  }
  export class Document {
    @Matches(IDENTIFIER) documentId!: string;
  }
}
