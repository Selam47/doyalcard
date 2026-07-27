// src/app/admin/rules/page.tsx
import type { Metadata } from "next";

import { getCampaignRules } from "@/actions/admin";
import { RulesManager } from "@/components/admin/RulesManager";

// Always reflect the latest campaign_rules rows — admins expect edits here
// to show up immediately, not after a static-cache revalidation window.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Kampanya Kuralları" };

export default async function RulesPage() {
  const rules = await getCampaignRules();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-800">Kampanya Kuralları</h1>
        <p className="text-gray-500 text-sm mt-1">
          Hangi sipariş sayısında hangi ödül verileceğini ayarlayın
        </p>
      </div>
      <RulesManager initialRules={rules} />
    </div>
  );
}
