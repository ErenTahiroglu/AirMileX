import { defineTool } from "@lovable.dev/mcp-js";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "get_account_status",
  title: "Get account status",
  description:
    "Return the signed-in AirMileX user's remaining credits, selected maps provider, and whether their Airtable and maps keys are configured.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase.rpc("get_settings_flags", {
      p_user_id: ctx.getUserId(),
    });
    if (error) {
      return { content: [{ type: "text", text: error.message }], isError: true };
    }
    const row = data?.[0];
    if (!row) {
      return { content: [{ type: "text", text: "No settings found for this account yet." }] };
    }
    const status = {
      credits: row.credits,
      maps_provider: row.maps_provider,
      airtable_connected: row.has_pat,
      maps_key_configured: row.has_maps_key,
    };
    return {
      content: [{ type: "text", text: JSON.stringify(status, null, 2) }],
      structuredContent: status,
    };
  },
});
