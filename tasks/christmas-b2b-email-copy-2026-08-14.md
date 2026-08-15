# Christmas 2026 B2B email: copy for review

Audience: 155 local businesses. Goal: Christmas bookings.
Every fact below is from `docs/SSOT.md` in the website repo (owner-confirmed 21 July and
11 to 13 August 2026). Nothing is invented, and two things are deliberately absent, noted at
the end.

The reader is the person who has been landed with organising it. That is who the copy talks to.

---

## Subject line, pick one

1. Your team's Christmas table, seven minutes from Terminal 5
2. Christmas bookings are open, and you get your own table
3. A Christmas do without the shared party night

Recommendation: 1. It leads with the thing a local business actually weighs up, which is
whether people can get there and get home.

## Preheader

Your own table, everyone picks their own courses, and free parking on the door.

---

## Hero

**Kicker:** Christmas 2026 · bookings open

**Headline:** Your team's Christmas, not a shared party night

**Body:**
We serve Christmas dinner from 10 November to 20 December. Your group gets its own table and
its own evening, never a shared sitting with another company.

Everyone picks their own courses too, so nobody is stuck with whatever the table agreed back
in October.

**Button:** Start your Christmas booking

---

## The rules, at a glance

| Dates | 10 November to 20 December 2026 |
| Sittings | Tuesday to Saturday, plus Sunday 1pm to 6pm. Never Mondays |
| Group size | 6 guests or more. Over 20 becomes a private hire |
| Deposit | £10 per person, taken off your bill |

---

## What your team gets

Every adult gets a glass of prosecco, swappable for orange juice. Christmas dinner comes with
pigs in blankets, stuffing, Yorkshire pudding, roast potatoes, mash, peas and sprouts.

- Everyone picks their own courses, rather than one choice the whole table commits to
- Pre-orders reach us 7 days before, so you are not chasing people on the day
- A Christmas quiz runs through the season, and a DJ can be arranged if you want one

**Button:** See the Christmas menu

---

## Two ways to do it, depending on numbers

**Six to twenty:** book a table like any other booking. Yours for the evening.

**Over twenty:** that becomes a private hire and we take it from there. Up to 60 seated, or
200 standing if you would rather people mingled.

**Thirty or more, standing:** the festive buffets are built for exactly that.

---

## Deadline strip

December Fridays and Saturdays go first. **Get your date held**

---

## Asked a lot

**Will we be sat with another company?**
No. Your group gets its own table and its own evening. We do not run shared party nights.

**Can people choose their own meals?**
Yes. Every guest picks their own courses, so the vegetarian is not an afterthought.

**How far ahead do you need everyone's choices?**
Seven days before your date, for the two and three course menus.

**What about parking and getting home?**
Around 20 free spaces on site, we sit outside the ULEZ, and we are seven minutes from
Terminal 5 and eight from Staines.

---

## Reassurance strip

No commitment, just a conversation · We reply within 24 hours · Free customer parking

---

## Closing panel

**Script line:** Talk to us

**Body:** Tell us your date and rough numbers and we will come back to you within 24 hours.

**Button:** Start your Christmas booking

Or call 01753 682707, or send us a WhatsApp on the same number.

---

## Sign-off

See you at the bar,
*The Anchor team*

**P.S.** Pre-orders are due seven days before your date, so the earlier it is in the diary,
the less chasing you end up doing. **Get your date held**

---

# Two decisions for the owner

## 1. Prices are deliberately absent

`docs/SSOT.md` is explicit about this:

> These figures are the owner-confirmed structure ... **They are not a publication source and
> not a fallback.** Every customer-facing Christmas price must be pulled live from the menu
> API. Do not copy these numbers into page code, JSON-LD, schemas or **marketing copy**.

An email is a frozen artefact: whatever price it carries is still sitting in an inbox in
December, so it cannot be pulled live at read time. The copy therefore sends people to the
page for prices rather than quoting them.

Worth knowing: **the designer's original campaign email breaks this rule**, with a price tile
carrying three hardcoded figures. If we reuse that block we are publishing prices from a
source the SSOT forbids.

Three options:

- **A. No prices in the email** (what the copy does now). Safest, compliant, and the page
  always tells the truth. Slightly weaker for a cold business audience.
- **B. One "from" price**, read live from the menu API when we compose, and re-checked before
  the send. Compliant in spirit, and still a snapshot.
- **C. Full price tiers** as the designer drew them. Strongest sales copy, and the one that
  breaks your own rule.

Recommendation: **B**. A single "from" figure is what a business needs to decide whether to
read on, the risk of one number drifting is small, and I would verify it against the live API
immediately before sending.

## 2. Over twenty needs to route to a human

The SSOT is firm that more than 20 guests is a private hire, not a table booking, and that
those enquiries go to manager@the-anchor.pub, 01753 682707 or WhatsApp. Most company Christmas
parties are larger than twenty, so for this audience that is not an edge case, it is probably
the main path.

The copy handles it with the "two ways to do it" section and the phone and WhatsApp in the
closing panel. Worth confirming that is how you want larger enquiries to arrive, rather than
through the booking form.

---

# Photographs this implies

Once the copy is signed off, these are the slots. Dimensions are from the designer's handover.

| Where | Supply at | Subject |
|---|---|---|
| Hero | 1200 x 680 | A table laid for Christmas dinner. Crackers, glasses, warm low light. Landscape, with room at the edges so a crop does not lose it |
| Two ways to do it | 520 x 360 each | One seated group at a table, one of the room set up for a standing do |
| Closing panel or a full-width band | 1200 x 520 | The pub looking warm from the outside in the dark, or the dining room dressed |

All JPEG, sRGB, under 200KB each. Real photographs of the pub, never stock.
