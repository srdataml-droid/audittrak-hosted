# AuditTrak, simply

**One job. Five kinds of evidence. One place to check them.**

Start at http://localhost:3000. The local demo sign-in is `demo@audittrak.local` with password `AuditTrakDemo2026!`. Open Amina’s logo job first.

## What the forms mean

| Form | What to enter | Simple example |
| --- | --- | --- |
| New job | A title, service, client and currency | Logo for Amina, NGN |
| Agreement | The work and price both parties agreed to | Logo design, 250,000 naira |
| Invoice | The actual bill and its date/number | INV-101, 250,000 naira |
| Payment | A transaction you are linking to this job | 250,000 received from Amina |
| Delivery | What you completed and when | Final logo files delivered |
| Evidence files | The original supporting documents | Chat export, invoice, receipt, delivery file |
| Confirmation | A link you share with the intended client | Client confirms or disputes this revision |

Amounts in the screen are whole currency amounts (for example, naira). The server stores minor units internally. A payment ID must be unique within your business. A money-returned/debit record reduces the net linked amount; check that it really belongs to this job.

## What to click

1. **Check this job** compares the saved records.
2. Read the explanations. A difference is a question for review, not an accusation.
3. Add missing delivery evidence before creating the confirmation link.
4. Open the confirmation link in another tab for a fictional demo response. Never answer on behalf of a real client.
5. Check again, then **Share for review**.
6. Sign in as `reviewer@audittrak.local`, password `ReviewAuditTrak2026!`, to read the shared job and add observations.

A changed job becomes a private draft again. Old assessments become stale; an old confirmation no longer applies to the new revision.

## The five pretend stories

- **Amina / Upwork-inspired:** agreement, invoice and payment each show 250,000. Delivery proof and confirmation are still needed.
- **Chidi / Fiverr-inspired:** the price increased from 300,000 to 350,000 after hosting was discussed. Review the amendment.
- **Zainab / Freelancer.com-inspired:** 90,000 arrived against a 180,000 invoice. Check the installment plan.
- **Kemi / Gmail-inspired:** the payer name differs from the client. Check the relationship.
- **Tobi / Telegram-inspired:** a 200,000 credit is offset by a 200,000 debit. Check both records.

These are five different fictional jobs with illustrations and matching synthetic records. No named app or bank is connected. The artwork is explanatory, not a claim about each platform’s actual interface or financial workflow.

## What the result means

“3/5 stages” means three kinds of evidence are present. It is not 60% proof, a credit score, or a probability that the story is true. “Strong supporting record” means the supplied record passes the implemented checks and has all five stages; a reviewer must still examine authenticity and context.

The business profile sums linked records by currency. It does not certify income. AI extraction, when configured, proposes fields for you to review and enter manually; it does not approve a job.
