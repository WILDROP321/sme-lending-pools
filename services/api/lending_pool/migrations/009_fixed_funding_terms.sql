UPDATE mock_companies SET decided_disbursement_cents=CASE WHEN risk_factor<20 THEN 0 ELSE money_requested_cents - CAST((money_requested_cents*5+50)/100 AS INTEGER) END WHERE status<>'approved';
