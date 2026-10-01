-- Some Internal Company rows have a Company Code and a blank Company Name.
-- The first seed copied the code into company_name. Keep the code on
-- company_code only, and leave the name blank when the sheet has none.

UPDATE master_companies
SET company_name = '',
    updated_at = CURRENT_TIMESTAMP
WHERE upper(trim(company_name)) = upper(trim(company_code));
