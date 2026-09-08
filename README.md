# AirMileX

Create a new web application using React, Vite, and Tailwind CSS. Integrate Supabase for backend and database.

Set up Email/Password authentication.

Create a clean, minimalist landing page with a login/register form.

Once logged in, redirect the user to a 'Dashboard' page.

In Supabase, create a 'user_settings' table with Row Level Security (RLS) enabled. It should have: id (uuid, primary key, linked to auth.users), airtable_pat (text), maps_api_key (text), maps_provider (text - either 'google' or 'openrouteservice').

Use 'Plan Mode' to outline the steps before generating code. Do not add complex animations. Focus strictly on functional routing, auth state, and database connection.



On the Dashboard page, create a 'Settings' or 'Integrations' component.

Add a form for the user to input and save their 'Airtable Personal Access Token (PAT)' and their 'Maps API Key'. Add a dropdown to select the maps provider (Google Maps or OpenRouteService).

Save these credentials securely to the 'user_settings' table in Supabase using the authenticated user's ID.

Add a visual indicator (like a green checkmark badge) to show if the keys are currently saved and active in the database.

Build a client-side function to test the Airtable PAT by making a simple fetch request to the Airtable API (e.g., an endpoint to verify access). Show a toast notification for success or error. Keep the UI brutally simple.



Create a new page called 'New Mileage Job'.

When the user opens this page, use their saved Airtable PAT to fetch and display a list of their accessible Airtable Bases and Tables via the Airtable Meta API. Allow them to select a Base, then a Table from dropdowns.

Once a Table is selected, fetch the column schemas for that table.

Create a 'Column Mapping' UI: Provide three dropdowns for the user to select which column represents the 'Start Address', which column represents the 'End Address', and which column is the 'Distance Output' (where we will write the result).

Add a 'Fetch Preview' button. This button retrieves the first 5 records from the selected Airtable table that have empty 'Distance Output' fields. Display these records in a simple, unstyled HTML table.



Finalize the workflow by writing data back to Airtable and creating an audit log.

Add a 'Sync to Airtable' button. When clicked, use the Airtable API (PATCH request) to update the mapped 'Distance Output' column for the successfully calculated records.

In Supabase, create a 'calculation_logs' table (id, user_id, records_processed, provider_used, created_at). Write a log entry after a successful sync to Airtable.

On the main Dashboard page, create a simple widget that reads from 'calculation_logs' and displays the total number of records the user has processed.

Ensure all async operations have clear loading states (spinners) and success/error toast notifications. The system must not freeze during batch requests.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://airmilex.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/2ddcbf47-9dca-4312-9373-c19dbade98fe).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
