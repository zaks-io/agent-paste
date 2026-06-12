import type { LegalDocument } from "./legal-types";

export const TERMS: LegalDocument = {
  path: "/terms",
  title: "Terms of Use",
  eyebrow: "Hosted service terms",
  description: "The terms that govern access to the agent-paste hosted service.",
  lead: "These terms govern your use of the agent-paste hosted service, including the dashboard, API, MCP server, CLI-backed hosted workflows, Access Links, and published Artifacts.",
  effectiveDate: "June 4, 2026",
  sections: [
    {
      id: "service",
      title: "The service",
      blocks: [
        {
          kind: "paragraph",
          text: "agent-paste is infrastructure for publishing and sharing agent-generated work products. The hosted service is provided by Zaks.io, LLC. The source code is licensed separately under Apache-2.0. These terms apply to the hosted service, not to your rights under the open source license.",
        },
        {
          kind: "paragraph",
          text: "The service is live in early alpha and may change. Features, limits, pricing, retention windows, and availability can be updated as the product matures.",
        },
      ],
    },
    {
      id: "eligibility-and-availability",
      title: "Eligibility and availability",
      blocks: [
        {
          kind: "paragraph",
          text: "You must be at least 18 years old to use the service. By using the service, you represent that you are 18 or older and can enter into these terms.",
        },
        {
          kind: "paragraph",
          text: "The service is currently offered only in the United States. Do not use the hosted service if you are outside the United States.",
        },
      ],
    },
    {
      id: "accounts-and-credentials",
      title: "Accounts and credentials",
      blocks: [
        {
          kind: "paragraph",
          text: "You are responsible for activity under your Workspace, authenticated sessions, automation credentials, and any agent or tool you authorize to use the service. Keep credentials secret and revoke or rotate them if you believe they were exposed.",
        },
        {
          kind: "paragraph",
          text: "Automation credentials are meant for controlled agent and workflow use. Do not embed them in public repositories, published Artifacts, client-side code, browser-visible pages, or logs.",
        },
      ],
    },
    {
      id: "content-and-rights",
      title: "Content and rights",
      blocks: [
        {
          kind: "paragraph",
          text: "You keep ownership of the files, metadata, and other content you publish. You grant Zaks.io, LLC the limited rights needed to host, process, secure, display, transmit, cache, back up, and delete that content as part of operating the service.",
        },
        {
          kind: "paragraph",
          text: "You are responsible for ensuring you have the rights and permissions needed to publish, share, and process the content you submit.",
        },
      ],
    },
    {
      id: "acceptable-use",
      title: "Acceptable use",
      blocks: [
        { kind: "paragraph", text: "Do not use the service to create, publish, host, distribute, or assist with:" },
        {
          kind: "list",
          items: [
            "malware, credential theft, phishing, spam, fraud, or deceptive impersonation",
            "content that violates law, privacy rights, intellectual property rights, or a person's safety",
            "attempts to bypass limits, authentication, authorization, rate limits, revocation, or abuse-response controls",
            "testing against accounts, Workspaces, Artifacts, Access Links, or systems you do not own or have permission to test",
            "bulk scraping, denial-of-service activity, resource exhaustion, or attempts to degrade the service for others",
          ],
        },
        {
          kind: "paragraph",
          text: "We may suspend access, remove or disable content, revoke credentials, or preserve records when needed to protect the service, users, third parties, or the public.",
        },
      ],
    },
    {
      id: "sharing-and-retention",
      title: "Sharing and retention",
      blocks: [
        {
          kind: "paragraph",
          text: "Access Links, Revision Links, and claim links are bearer-style sharing mechanisms. Anyone with a valid link may be able to access the content or action the link permits until it expires, is revoked, or is otherwise disabled.",
        },
        {
          kind: "paragraph",
          text: "Artifacts are transient by default. Auto Deletion, expiration, revocation, and abuse-response controls may make content unavailable before physical storage cleanup completes.",
        },
      ],
    },
    {
      id: "security-research",
      title: "Security research",
      blocks: [
        {
          kind: "paragraph",
          text: "Good-faith security research is welcome when it stays within systems and data you own or have explicit permission to test. Do not access, modify, delete, retain, or exfiltrate another user's data. Report vulnerabilities privately through the process in the Security Policy.",
        },
      ],
    },
    {
      id: "third-party-services",
      title: "Third-party services",
      blocks: [
        {
          kind: "paragraph",
          text: "The service depends on third-party providers for hosting, authentication, storage, payments when billing is enabled, email or support workflows, and operational diagnostics. Their services may have their own terms and policies.",
        },
      ],
    },
    {
      id: "paid-features",
      title: "Paid features",
      blocks: [
        {
          kind: "paragraph",
          text: "Some features may require payment or a paid Plan. Pricing, limits, renewal terms, and cancellation details will be shown where you subscribe or manage billing. Taxes may apply.",
        },
      ],
    },
    {
      id: "disclaimers",
      title: "Disclaimers",
      blocks: [
        {
          kind: "paragraph",
          text: "The service is provided as is and as available. To the maximum extent permitted by law, Zaks.io, LLC disclaims warranties of merchantability, fitness for a particular purpose, non-infringement, uninterrupted availability, and error-free operation.",
        },
        {
          kind: "paragraph",
          text: "You are responsible for evaluating whether the service is appropriate for your data, compliance duties, uptime needs, and security requirements.",
        },
      ],
    },
    {
      id: "liability",
      title: "Limitation of liability",
      blocks: [
        {
          kind: "paragraph",
          text: "To the maximum extent permitted by law, Zaks.io, LLC will not be liable for indirect, incidental, special, consequential, exemplary, or punitive damages, or for lost profits, revenues, goodwill, data, or business opportunities.",
        },
        {
          kind: "paragraph",
          text: "To the maximum extent permitted by law, Zaks.io, LLC's total liability for claims relating to the hosted service is limited to the amount you paid for the service in the three months before the event giving rise to the claim, or 100 USD if you did not pay for the service.",
        },
      ],
    },
    {
      id: "changes",
      title: "Changes",
      blocks: [
        {
          kind: "paragraph",
          text: "We may update these terms as the service changes. If a change materially affects your rights or obligations, we will take reasonable steps to provide notice, such as posting the updated terms or surfacing notice in the service.",
        },
      ],
    },
    {
      id: "contact",
      title: "Contact",
      blocks: [
        {
          kind: "paragraph",
          text: "The hosted service is operated by Zaks.io, LLC. Questions about these terms can be sent to contact@agent-paste.sh. Security reports should follow the private reporting process in the Security Policy.",
        },
        {
          kind: "paragraph",
          text: "Mailing address: Zaks.io, LLC, 2108 N St, Ste N, Sacramento, CA 95816, USA.",
        },
      ],
    },
  ],
};
