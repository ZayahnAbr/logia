import { LegalDoc, legalMetadata } from "../LegalDoc";

export const metadata = legalMetadata("acceptable-use");
export default function Page() { return <LegalDoc slug="acceptable-use" />; }
