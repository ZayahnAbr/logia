import { LegalDoc, legalMetadata } from "../LegalDoc";

export const metadata = legalMetadata("takedown");
export default function Page() { return <LegalDoc slug="takedown" />; }
