import { LegalDoc, legalMetadata } from "../LegalDoc";

export const metadata = legalMetadata("terms");
export default function Page() { return <LegalDoc slug="terms" />; }
