# COD collection and supplier payouts

## COD money flow
1. Customer chooses Cash on Delivery and pays the delivery partner when the parcel arrives.
2. The courier collects cash; SeasonKart does not automatically receive it at checkout.
3. The courier remits COD proceeds to the merchant bank account according to the courier account/contract and settlement cycle. Configure COD with your courier provider and provide verified merchant bank details there.
4. Reconcile each courier COD remittance against courier settlement reports, delivered order codes, shipping/COD fees, RTO/returns and bank credits. Only consider COD proceeds received after the bank credit is confirmed.
5. After the order is Delivered and payment/COD status is verified, create the supplier payout ledger entry. This only records payable; it does not send money. Transfer to the supplier's saved UPI ID or bank account and then mark Paid using the actual UTR/transaction reference.

## Supplier payment details
Supplier signs in to their portal and saves either a UPI ID or bank account holder, account number, bank name and IFSC. Admin payout rows show these details. Confirm the destination with the supplier before sending money; this app does not initiate bank/UPI transfers. Never ask for UPI PIN, OTP, card PIN or password.

## Install migration safely
Back up database first. This project already has migrations 1-13 in the existing database, so do NOT blindly run all migrations from an empty migration tracker. Verify that migrations 1-13 are already represented in the live schema, then apply only `migrate14.sql` once using your normal MySQL migration procedure. If columns already exist, do not rerun it.

Commission basis for new payouts: item value minus proportional coupon discount, excluding delivery charge; SeasonKart 20%, supplier 80%. Tax/GST treatment must match your supplier agreement and applicable advice. Existing ledger amounts are not backfilled or recalculated.
