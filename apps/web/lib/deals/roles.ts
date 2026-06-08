/**
 * Determines which party is the seller (supplier) and which is the buyer
 * for a given deal. Import from here everywhere — never derive from org.type
 * for deal role logic.
 */

interface DealWithRoles {
  buyer_org_id: string | null
  supplier_org_id: string | null
}

export function getDealRoles(deal: DealWithRoles, userOrgId: string) {
  return {
    sellerOrgId: deal.supplier_org_id,
    buyerOrgId: deal.buyer_org_id,
    currentUserIsSeller: deal.supplier_org_id === userOrgId,
    currentUserIsBuyer: deal.buyer_org_id === userOrgId,
  }
}

/**
 * Given a listing type, returns which party is the seller and which is the buyer.
 * listing_type = 'product_service': poster = seller, offer submitter = buyer
 * listing_type = 'po_request': poster = buyer, offer submitter = seller
 */
export function getRolesFromListingType(
  listingType: string,
  listingOrgId: string,
  offerorOrgId: string
): { buyerOrgId: string; supplierOrgId: string } {
  if (listingType === 'po_request') {
    return { buyerOrgId: listingOrgId, supplierOrgId: offerorOrgId }
  }
  return { supplierOrgId: listingOrgId, buyerOrgId: offerorOrgId }
}
