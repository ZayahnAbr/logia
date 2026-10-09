import { LegalDoc, legalMetadata } from "../LegalDoc";

export const metadata = legalMetadata("privacy");
export default function Page() { return <LegalDoc slug="privacy" />; }
