import type { ModelVendor } from "./modelCardsApi";

export function VendorLogo({ vendor }: { vendor: ModelVendor }) {
  return <span className={`model-vendor-logo is-${vendor}`}>
    {vendor === "custom" ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="4" /><path d="m9 9-3 3 3 3m6-6 3 3-3 3" /></svg>
      : <img src={`/model-providers/${vendor}.svg`} alt="" width={32} height={32} />}
  </span>;
}
