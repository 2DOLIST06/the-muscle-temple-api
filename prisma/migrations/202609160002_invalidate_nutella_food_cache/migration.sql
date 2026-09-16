-- Refresh the product after expanding the Open Food Facts fields and image normalization.
DELETE FROM "FoodProductCache"
WHERE "barcode" = '3017624010701';
