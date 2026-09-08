import { auth, defineMcp } from "@lovable.dev/mcp-js";
import getAccountStatusTool from "./tools/get-account-status";
import listCalculationLogsTool from "./tools/list-calculation-logs";
import listSavedMappingsTool from "./tools/list-saved-mappings";

// Build the OAuth issuer from the project ref (inlined at build time), never from SUPABASE_URL.
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "airmilex",
  title: "AirMileX",
  version: "0.1.0",
  instructions:
    "Tools for AirMileX, an Airtable mileage calculator. Use `get_account_status` for remaining credits and connection status, `list_calculation_logs` for recent mileage jobs, and `list_saved_mappings` for saved Airtable column mappings.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [getAccountStatusTool, listCalculationLogsTool, listSavedMappingsTool],
});
