import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_calculation_logs",
  title: "List mileage jobs",
  description:
    "List the signed-in user's recent mileage calculation jobs, newest first, with the Airtable base and table, record count, and provider used.",
  inputSchema: {
    limit: z.number().int().optional().describe("How many jobs to return (1-100, default 20)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const take = Math.min(Math.max(Math.trunc(limit ?? 20), 1), 100);
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase
      .from("calculation_logs")
      .select("id, base_id, table_id, records_processed, provider_used, created_at")
      .order("created_at", { ascending: false })
      .limit(take);
    if (error) {
      return { content: [{ type: "text", text: error.message }], isError: true };
    }
    const jobs = data ?? [];
    return {
      content: [{ type: "text", text: JSON.stringify(jobs, null, 2) }],
      structuredContent: { jobs, count: jobs.length },
    };
  },
});
