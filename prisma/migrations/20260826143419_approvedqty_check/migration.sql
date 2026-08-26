-- AddConstraint
-- Keep approvedQty within a sane range: null (undecided) or 0..qty.
ALTER TABLE "WarehouseRequest" ADD CONSTRAINT "WarehouseRequest_approvedQty_range" CHECK (("approvedQty" IS NULL) OR ("approvedQty" >= 0 AND "approvedQty" <= "qty"));
