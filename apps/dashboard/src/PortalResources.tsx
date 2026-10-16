import { legalEn } from "../../../packages/localization/src/legal-copy";
import {
  portalResourceIntro,
  portalResourceItems,
  portalResourceSections,
  portalResourceTitle,
  type PortalResourceId,
  type PortalResourceRole,
} from "./portal-resource-content";
import "./portal-resources.css";

export type { PortalResourceId } from "./portal-resource-content";

export type PortalResourceAccount = {
  displayName?: string | null;
  username?: string | null;
  contactNumber?: string | null;
  status?: string | null;
  storeName?: string | null;
  storeStatus?: string | null;
};

export function PortalResourceMenu({
  role,
  onOpen,
}: {
  role: PortalResourceRole;
  onOpen: (resource: PortalResourceId) => void;
}) {
  return (
    <section className="portal-resource-menu" aria-labelledby={`portal-resources-title-${role}`}>
      <div className="portal-resource-menu-heading">
        <div>
          <p className="portal-resource-eyebrow">Account information</p>
          <h3 id={`portal-resources-title-${role}`}>Help & legal</h3>
          <p>Support guidance, privacy information and current terms.</p>
        </div>
      </div>
      <nav className="portal-resource-list" aria-label="Help, privacy and terms">
        {portalResourceItems.map((item) => (
          <button
            key={item.id}
            className="portal-resource-row"
            data-testid={`button-resource-${role}-${item.id}`}
            type="button"
            onClick={() => onOpen(item.id)}
          >
            <span className="portal-resource-icon" aria-hidden="true">
              <ResourceIcon icon={item.icon} />
            </span>
            <span className="portal-resource-copy">
              <strong>{item.title}</strong>
              <span>{item.description}</span>
            </span>
            <span className="portal-resource-chevron" aria-hidden="true">›</span>
          </button>
        ))}
      </nav>
    </section>
  );
}

export function PortalResourcePage({
  role,
  resource,
  account,
  onBack,
}: {
  role: PortalResourceRole;
  resource: PortalResourceId;
  account?: PortalResourceAccount | null;
  onBack: () => void;
}) {
  const isLegalDraft = resource === "privacy" || resource === "terms";
  const roleName = role === "vendor" ? "Vendor" : "Delivery Partner";
  const sections = portalResourceSections(role, resource);

  return (
    <article className="portal-resource-page" data-testid={`page-resource-${role}-${resource}`}>
      <button className="portal-resource-back" data-testid="button-resource-back" onClick={onBack} type="button">
        <span aria-hidden="true">‹</span>
        Back to {role === "vendor" ? "Account & Settings" : "Profile"}
      </button>
      <header className="portal-resource-page-heading">
        <p className="portal-resource-eyebrow">{roleName} portal</p>
        <h2>{portalResourceTitle(resource)}</h2>
        <p>{portalResourceIntro(role, resource)}</p>
      </header>

      {isLegalDraft && (
        <aside className="portal-resource-draft" data-testid={`status-resource-draft-${resource}`} role="note">
          <strong>{legalEn["legal.draftTitle"]}</strong>
          <p>
            {resource === "terms"
              ? "These source-based terms and role-specific additions are informational drafts only. No Vendor or Delivery Partner acceptance is recorded here, and no effective date is established."
              : "The Customer notice remains unchanged. This role-specific summary needs owner confirmation and qualified legal review before publication."}
          </p>
        </aside>
      )}

      {resource === "help" && (
        <aside className="portal-resource-config-note" data-testid="status-resource-support-unconfigured" role="status">
          <strong>No support channel is configured</strong>
          <p>
            There is no verified support contact or working request destination in this application. To enable support, configure an owner-approved contact or a secure authenticated request endpoint with an authorized Admin review queue. No message or ticket has been submitted.
          </p>
        </aside>
      )}

      {resource === "accountPrivacy" && (
        <section className="portal-resource-account" aria-labelledby="portal-resource-account-title">
          <h3 id="portal-resource-account-title">Information available to your account</h3>
          <dl>
            <AccountRow label="Portal role" value={roleName} />
            {role === "vendor" ? (
              <>
                <AccountRow label="Your store" value={account?.storeName || "Not available"} />
                <AccountRow label="Store approval status" value={formatStatus(account?.storeStatus)} />
              </>
            ) : (
              <>
                <AccountRow label="Display name" value={account?.displayName || "Not available"} />
                <AccountRow label="Username" value={account?.username || "Not available"} />
                <AccountRow label="Contact number" value={account?.contactNumber || "Not provided"} />
                <AccountRow label="Account status" value={formatStatus(account?.status)} />
              </>
            )}
          </dl>
        </section>
      )}

      <div className="portal-resource-sections">
        {sections.map((section, index) => (
          <section
            className="portal-resource-section"
            data-testid={`card-resource-section-${resource}-${index}`}
            key={`${resource}-${index}`}
          >
            {section.draft && <p className="portal-resource-section-label">Draft addition · review required</p>}
            <h3>{section.title}</h3>
            <p>{section.body}</p>
          </section>
        ))}
      </div>
      {resource === "accountPrivacy" && (
        <p className="portal-resource-footnote" data-testid="status-resource-privacy-actions">
          Account deletion, full data export and privacy-request submission are not available from this portal. No request is sent by viewing this page.
        </p>
      )}
    </article>
  );
}

function AccountRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="portal-resource-account-row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function formatStatus(status?: string | null) {
  if (!status) return "Not available";
  return status.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase());
}

function ResourceIcon({ icon }: { icon: (typeof portalResourceItems)[number]["icon"] }) {
  const common = { fill: "none", stroke: "currentColor", strokeLinecap: "round" as const, strokeLinejoin: "round" as const, strokeWidth: 1.8 };
  if (icon === "help") return <svg viewBox="0 0 24 24" {...common}><circle cx="12" cy="12" r="9" /><path d="M9.6 9a2.5 2.5 0 1 1 4.4 1.6c-1.1 1.1-2 1.2-2 3" /><path d="M12 17h.01" /></svg>;
  if (icon === "shield") return <svg viewBox="0 0 24 24" {...common}><path d="M12 3 20 6v5c0 5-3.4 8.2-8 10-4.6-1.8-8-5-8-10V6l8-3Z" /><path d="M9 12.2 11 14l4-4" /></svg>;
  if (icon === "account") return <svg viewBox="0 0 24 24" {...common}><circle cx="12" cy="8" r="3.2" /><path d="M5.5 20a6.5 6.5 0 0 1 13 0" /><circle cx="12" cy="12" r="9" /></svg>;
  return <svg viewBox="0 0 24 24" {...common}><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v5h5M9 13h6M9 17h6" /></svg>;
}
