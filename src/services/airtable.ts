import { supabase } from "@/integrations/supabase/client";
import { runBatched } from "@/lib/rateLimiter";


const callProxy = async (action: string, payload: Record<string, unknown> | object) => {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Not authenticated");

  const response = await supabase.functions.invoke("airtable-proxy", {
    body: { action, ...payload },
  });

  if (response.error) throw new Error(response.error.message);
  return response.data;
};

export const testConnection = () =>
  callProxy("whoami", {});

export const listBases = () =>
  callProxy("list-bases", {});

export const listTables = (baseId: string) =>
  callProxy("list-tables", { baseId });

export const readRecords = (
  baseId: string,
  tableId: string,
  distanceFieldId: string,
  limit = 5
) =>
  callProxy("read-records", { baseId, tableId, distanceFieldId, limit });

export interface SyncPayload {
  baseId: string;
  tableId: string;
  distanceFieldId: string;
  records: { id: string; value: string }[];
}

export const syncRecords = (payload: SyncPayload) =>
  callProxy("sync-records", payload);
