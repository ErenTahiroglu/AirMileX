import { defineTool } from "@lovable.dev/mcp-js";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_saved_mappings",
  title: "List saved column mappings",
  description:
    "List the signed-in user's saved Airtable column mappings (start address, end address, and distance output column per table).",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase
      .from("saved_mappings")
      .select("id, table_id, start_col_id, end_col_id, distance_col_id");
    if (error) {
      return { content: [{ type: "text", text: error.message }], isError: true };
    }
    const mappings = data ?? [];
    return {
      content: [{ type: "text", text: JSON.stringify(mappings, null, 2) }],
      structuredContent: { mappings, count: mappings.length },
    };
  },
});
