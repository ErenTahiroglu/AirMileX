import { supabase } from "@/integrations/supabase/client";

const callProxy = async (action: string, payload: Record<string, unknown>) => {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Not authenticated");

  const response = await supabase.functions.invoke("airtable-proxy", {
    body: { action, ...payload },
  });

  if (response.error) throw new Error(response.error.message);
  return response.data;
};

export const testConnection = (pat: string) =>
  callProxy("whoami", { pat });

export const listBases = (pat: string) =>
  callProxy("list-bases", { pat });

export const listTables = (pat: string, baseId: string) =>
  callProxy("list-tables", { pat, baseId });

export const readRecords = (
  pat: string,
  baseId: string,
  tableId: string,
  distanceFieldId: string,
  limit = 5
) =>
  callProxy("read-records", { pat, baseId, tableId, distanceFieldId, limit });

export interface SyncPayload {
  pat: string;
  baseId: string;
  tableId: string;
  distanceFieldId: string;
  records: { id: string; value: string }[];
}

export const syncRecords = (payload: SyncPayload) =>
  callProxy("sync-records", payload);
