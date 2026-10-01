# PoliTrak — Key Biscayne (published site)

A political transparency tracker for Key Biscayne, Florida: every sitting official, candidate and
prospective candidate tied to their public records — campaign contributions and spending, council
votes, ethics disclosures, companies on Sunbiz, licences, properties, lobbyists and advisory board
seats. **Every fact on the site links to the public record it came from.**

- **Map and summary:** [index.html](https://pskdude1224.github.io/politrak-site/)
- **The dashboard:** [app.html](https://pskdude1224.github.io/politrak-site/app.html#/web) —
  Network, Profile, Issues, Money, Leads, Filings, Records.

## What this repository is

Only the built, public-facing site: HTML, CSS, JavaScript and one generated data file. It is
published from a private repository that holds the source tables, the raw records and the
fetchers. Nothing here is hand-edited; the private pipeline rebuilds `data.js` and the site is
updated from it.

## Privacy

The site is built to be public:

- Officials and candidates get a full profile, including the residence they swear to on their
  qualifying papers, which is a public record of their eligibility.
- Everyone else named in a record — a co-officer, a donor, a board member, a counterparty —
  appears with their name, occupation and city only. No street address, no contact details.
- A property owned by someone who is not a public figure is shown by its folio number, never by
  its address.
- Text copied from scanned records is scrubbed of anything shaped like a street address.
- "Leads" are questions raised by the records, not findings. Each says what to check.

If you are named here and something is wrong, open an issue on this repository and say which row
and which record; corrections are logged.
