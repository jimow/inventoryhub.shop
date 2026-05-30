-- 00011_settings_expand.sql
-- Expand settings.data with broad configurability so each shop can customise.
-- Existing keys are preserved; we only fill in new keys via JSONB merge.

update public.settings
   set data = data || jsonb_build_object(
     'branding',  coalesce(data->'branding',  '{}'::jsonb) || jsonb_build_object(
       'logoUrl',       coalesce(data->'branding'->>'logoUrl',       ''),
       'primaryColor',  coalesce(data->'branding'->>'primaryColor',  '#2563eb'),
       'accentColor',   coalesce(data->'branding'->>'accentColor',   '#0ea5e9')
     ),
     'locale',    coalesce(data->'locale',    '{}'::jsonb) || jsonb_build_object(
       'country',            coalesce(data->'locale'->>'country',            'KE'),
       'language',           coalesce(data->'locale'->>'language',           'en'),
       'dateFormat',         coalesce(data->'locale'->>'dateFormat',         'YYYY-MM-DD'),
       'timeFormat',         coalesce(data->'locale'->>'timeFormat',         '24h'),
       'weekStart',          coalesce((data->'locale'->>'weekStart')::int,   1),
       'decimalPlaces',      coalesce((data->'locale'->>'decimalPlaces')::int, 2),
       'thousandsSeparator', coalesce(data->'locale'->>'thousandsSeparator', ','),
       'decimalSeparator',   coalesce(data->'locale'->>'decimalSeparator',   '.')
     ),
     'currency',  coalesce(data->'currency',  '{}'::jsonb) || jsonb_build_object(
       'position', coalesce(data->'currency'->>'position', 'before'),
       'rounding', coalesce(data->'currency'->>'rounding', 'none')
     ),
     'tax',       coalesce(data->'tax',       '{}'::jsonb) || jsonb_build_object(
       'name',           coalesce(data->'tax'->>'name',                       'VAT'),
       'inclusive',      coalesce((data->'tax'->>'inclusive')::bool,          false),
       'registrationNo', coalesce(data->'tax'->>'registrationNo',             '')
     ),
     'pos',       coalesce(data->'pos',       '{}'::jsonb) || jsonb_build_object(
       'quickAmounts',     coalesce(data->'pos'->'quickAmounts',
                                    '[50,100,200,500,1000,2000]'::jsonb),
       'requireCustomer',  coalesce((data->'pos'->>'requireCustomer')::bool,  false),
       'defaultCustomerId',coalesce(data->'pos'->>'defaultCustomerId',        null),
       'autoPrintReceipt', coalesce((data->'pos'->>'autoPrintReceipt')::bool, false),
       'scannerEnter',     coalesce((data->'pos'->>'scannerEnter')::bool,     true),
       'confirmCancel',    coalesce((data->'pos'->>'confirmCancel')::bool,    true),
       'decimalQty',       coalesce((data->'pos'->>'decimalQty')::bool,       false)
     ),
     'receipt',   coalesce(data->'receipt',   '{}'::jsonb) || jsonb_build_object(
       'paperWidth',       coalesce(data->'receipt'->>'paperWidth',           '80mm'),
       'header',           coalesce(data->'receipt'->>'header',               ''),
       'footer',           coalesce(data->'receipt'->>'footer',               'Thank you for your business!'),
       'returnPolicy',     coalesce(data->'receipt'->>'returnPolicy',         ''),
       'showLogo',         coalesce((data->'receipt'->>'showLogo')::bool,     true),
       'showTaxBreakdown', coalesce((data->'receipt'->>'showTaxBreakdown')::bool, true)
     ),
     'inventory', coalesce(data->'inventory', '{}'::jsonb) || jsonb_build_object(
       'lowStockThreshold',  coalesce((data->'inventory'->>'lowStockThreshold')::int,
                                     coalesce((data->>'lowStockThreshold')::int, 5)),
       'allowNegativeStock', coalesce((data->'inventory'->>'allowNegativeStock')::bool, false),
       'valuationMethod',    coalesce(data->'inventory'->>'valuationMethod',  'average')
     ),
     'sales',     coalesce(data->'sales',     '{}'::jsonb) || jsonb_build_object(
       'defaultType',       coalesce(data->'sales'->>'defaultType',          'cash'),
       'defaultCreditDays', coalesce((data->'sales'->>'defaultCreditDays')::int, 30),
       'confirmCancel',     coalesce((data->'sales'->>'confirmCancel')::bool, true),
       'allowBackdate',     coalesce((data->'sales'->>'allowBackdate')::bool, false),
       'maxBackdateDays',   coalesce((data->'sales'->>'maxBackdateDays')::int, 7)
     ),
     'purchases', coalesce(data->'purchases', '{}'::jsonb) || jsonb_build_object(
       'defaultCreditDays', coalesce((data->'purchases'->>'defaultCreditDays')::int, 30),
       'confirmCancel',     coalesce((data->'purchases'->>'confirmCancel')::bool, true),
       'allowBackdate',     coalesce((data->'purchases'->>'allowBackdate')::bool, true)
     ),
     'accounting',coalesce(data->'accounting','{}'::jsonb) || jsonb_build_object(
       'fiscalYearStartMonth', coalesce((data->'accounting'->>'fiscalYearStartMonth')::int, 1),
       'defaultCashAccountCode',    coalesce(data->'accounting'->>'defaultCashAccountCode',    '1010'),
       'defaultBankAccountCode',    coalesce(data->'accounting'->>'defaultBankAccountCode',    '1100'),
       'defaultRevenueAccountCode', coalesce(data->'accounting'->>'defaultRevenueAccountCode', '4000'),
       'defaultCogsAccountCode',    coalesce(data->'accounting'->>'defaultCogsAccountCode',    '5000')
     )
   )
 where id = 1;
