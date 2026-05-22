# Couldn't Work Import Review

Generated: 2026-05-22T12:32:19.941Z

Scope: employee notes, employee/rota audit trail, and WhatsApp exports in `/Users/peterpitcher/Library/Mobile Documents/com~apple~CloudDocs/Temp stuff/WhatsApp exports`.

Import rule used: only recommend importing rota-covered dates from 2025-01-01 onwards. Earlier WhatsApp evidence predates the current rota dataset and is not included in the import list.

Implementation shape: use `markEmployeeCouldntWork({ weekId, employeeId, shiftDate, reason })`. That creates a 00:00 Couldn't Work marker and moves any scheduled shifts for that employee/date to open shifts.

Summary: 31 import, 7 manual review, 2 skip, 2 already present. Audit trail also contains Peter/Peter test rows with `sick_reason = Test`; I excluded them because they are explicit test data and there is no current real Couldn't Work row to import.

## Import

| Date | Employee | Current rota evidence | Reason to store | Source/evidence | Proposed DB action |
|---|---|---|---|---|---|
| 2025-01-19 | Jamie Chaplin | assigned shifts: 17:00:00-22:00:00 bar scheduled (Sunday Close) | Headache; requested cover for 17:00-22:00 shift. | WhatsApp FOH 2025-01-19: Asked for cover tonight 5-10 due to headache. | markEmployeeCouldntWork week_id=1d410f2a-c133-41ea-baca-e52cea1da16b |
| 2025-02-06 | Lauren Harding | no current assigned shift row | Unwell; Jamie covered 18:00-close. | WhatsApp FOH 2025-02-06: Asked for cover for 6-close because she was really not well and needed bed; Jamie covered. | markEmployeeCouldntWork week_id=1e12fab5-59a3-4633-b663-63ad5db0a020 |
| 2025-03-03 | Amanda Jones | no current assigned shift row | Medical issue; Lance covered shift. | WhatsApp Mandy direct 2025-03-03: Abscess burst, in pain; Lance said he would cover shift today. | markEmployeeCouldntWork week_id=afbf2d9c-8756-40ec-be72-535d64ebc50f |
| 2025-03-06 | Jazz Forsey | no current assigned shift row | Family emergency; unable to do evening shift. | WhatsApp FOH 2025-03-06: Family emergency regarding mum; would not be able to do shift this evening. | markEmployeeCouldntWork week_id=afbf2d9c-8756-40ec-be72-535d64ebc50f |
| 2025-03-27 | Jazz Forsey | no current assigned shift row | Anxiety and sickness; requested cover for 18:00-22:00. | WhatsApp FOH 2025-03-27: Asked cover for 18:00-22:00; anxiety and sickness. | markEmployeeCouldntWork week_id=503fa063-1e3e-4347-bee6-ee3d1892672b |
| 2025-04-18 | Amanda Jones | assigned shifts: 12:00:00-18:00:00 bar scheduled | Hospital/medical issue; needed opening cover. | WhatsApp FOH 2025-04-18: Asked someone to open at 12 because she had to go to hospital with bleeding mole/lip. | markEmployeeCouldntWork week_id=661a8b98-5283-4f2d-ae15-1d840ac07b7b |
| 2025-05-12 | Jazz Forsey | assigned shifts: 18:00:00-22:00:00 bar scheduled | Unwell; requested cover for 18:00-22:00. | WhatsApp FOH 2025-05-12: Asked cover for 18:00-22:00; not feeling well and not up to it. | markEmployeeCouldntWork week_id=ec79e26c-80fc-4c8a-884b-f6726837d96a |
| 2025-06-05 | Sean Low | assigned shifts: 18:00:00-22:00:00 bar scheduled (Thursday Close) | Food poisoning. | employee note 2025-06-05: Sean messaged to say he cannot work tonight because food poisoning. | markEmployeeCouldntWork week_id=11242389-dd20-4aa6-ab54-c6e4dec33b36 |
| 2025-06-08 | Oakley McNulty | no current assigned shift row | Personal plans; told manager he could not work 8 June. | employee note 2025-06-05: Oakley told manager he cannot work 8 June because he is going out that weekend. | markEmployeeCouldntWork week_id=11242389-dd20-4aa6-ab54-c6e4dec33b36 |
| 2025-06-20 | Oakley McNulty | assigned shifts: 18:00:00-21:00:00 runner scheduled | Parents wedding. | employee note 2025-06-20: Oakley said the previous night he could not work tonight because of parents wedding. | markEmployeeCouldntWork week_id=029a1930-d323-4d2a-81c2-ba36af7af825 |
| 2025-06-29 | Jamie Chaplin | assigned shifts: 12:00:00-17:00:00 kitchen scheduled | Felt really rough. | employee note 2025-06-29: Messaged Bill saying he would not be in because he felt really rough. | markEmployeeCouldntWork week_id=4d5a2694-1058-46ca-a684-020a914aae27 |
| 2025-07-12 | Jamie Chaplin | no current assigned shift row | Transport issues; stuck returning from Yarmouth. | employee note 2025-07-13: Unable to attend shift on 12 July due to transport issues returning from Yarmouth; stuck/no train. | markEmployeeCouldntWork week_id=654be7c3-b64b-4945-b491-e9a147666140 |
| 2025-08-09 | Maria Gurtatowska | assigned shifts: 18:00:00-00:00:00 bar scheduled | Sickness continued; manager covered Saturday. | employee note 2025-08-18: Manager covered Saturday 9 Aug after Maria was sick/sent home Friday. | markEmployeeCouldntWork week_id=a27c6600-12b5-4919-b6a7-e41fc359314d |
| 2025-08-10 | Oakley McNulty | assigned shifts: 12:00:00-17:00:00 runner scheduled | Sick. | employee note 2025-08-18: Sick on Sunday 10 August. | markEmployeeCouldntWork week_id=a27c6600-12b5-4919-b6a7-e41fc359314d |
| 2025-08-30 | Paige Pantlin | no current assigned shift row | Flight cancelled; not back for Saturday shift. | WhatsApp FOH 2025-08-28: Unable to do Saturday 18:00-00:00 shift because flight cancelled and would not be back. | markEmployeeCouldntWork week_id=a7b3aa5b-c972-4ce0-92e2-c5439f07b0e3 |
| 2025-09-19 | Amanda Jones | no current assigned shift row | Child hospital appointment; cover requested for 16:00-19:00. | employee note + WhatsApp FOH 2025-09-12/16: Adele hospital appointment; asked cover Friday 19th 16:00-19:00. | markEmployeeCouldntWork week_id=423ca255-9cca-48d2-b475-56c67d08104d |
| 2025-10-27 | Jordan Bowman | no current assigned shift row | Brother in hospital; unable to do agreed cover shift. | employee note 2025-10-26 + Mandy direct 2025-10-26: Brother in hospital; could not do tomorrow / unable to cover Mandy shift 19:00-22:00 as agreed. | markEmployeeCouldntWork week_id=f1bbc855-868b-4573-a10f-9bca720486ba |
| 2025-10-30 | Paige Pantlin | no current assigned shift row | Sick absence; stress/anxiety context from return-to-work notes. | employee notes 2025-10-30 and 2025-11-06: Texted in sick; later explained off sick due stress/anxiety and not in state to come in. | markEmployeeCouldntWork week_id=f1bbc855-868b-4573-a10f-9bca720486ba |
| 2025-11-03 | Amanda Jones | assigned shifts: 16:00:00-22:00:00 bar scheduled (Monday) | Child sickness; cover requested for 16:00-22:00. | employee note + WhatsApp FOH/direct 2025-11-03: Adele vomiting/temperature; asked for whole cover 16:00-22:00. | markEmployeeCouldntWork week_id=f45b9b15-a2da-4fa9-bce2-be7d0a9d9f1e |
| 2025-11-28 | Jordan Bowman | assigned shifts: 19:00:00-00:00:00 bar scheduled | Not well; called in before 19:00 shift. | employee note + WhatsApp FOH 2025-11-28: Called in two hours before shift saying not well and cannot work from 19:00. | markEmployeeCouldntWork week_id=6db9a729-935e-4b9d-99e6-7e9b4c20fceb |
| 2025-12-28 | Lance Marlow | no current assigned shift row | Travel disruption; stuck in Belgium. | WhatsApp FOH 2025-12-27: Asked cover for tomorrow evening 17:00-22:00 because stuck in Belgium. | markEmployeeCouldntWork week_id=16f48cc0-0fc1-4c68-aa7f-3327be9bcba9 |
| 2026-01-16 | Jacob Hambridge | no current assigned shift row | Unwell; cover requested for 19:00-22:00. | WhatsApp FOH 2026-01-16: Jacob unwell and unable to work tonight 19:00-22:00; Laura covered. | markEmployeeCouldntWork week_id=762637b7-c484-4b40-84a6-d23f06e2f378 |
| 2026-01-17 | Jordan Bowman | assigned shifts: 18:00:00-22:00:00 bar scheduled (Saturday Close) | Missed/attempted sick call; woke late and did not realise shift. | employee note 2026-01-21: Tried to call in sick; said he woke up late and did not realise he had a shift. | markEmployeeCouldntWork week_id=762637b7-c484-4b40-84a6-d23f06e2f378 |
| 2026-01-23 | Jordan Bowman | no current assigned shift row | Vomiting/flu. | employee note + WhatsApp FOH 2026-01-23: Asked cover tonight; vomiting all night, rough for days, flu. | markEmployeeCouldntWork week_id=d3aca056-df30-4bd7-84eb-7b6d3fc5f292 |
| 2026-03-09 | Amanda Jones | no current assigned shift row | Family hospital emergency; shift covered by Billy/Ryan/Lance. | employee note 2026-03-09: Called in because granddaughter/baby rushed to hospital; cover arranged Billy/Ryan/Lance. | markEmployeeCouldntWork week_id=251a8b3d-a282-47db-bcd1-204be8196492 |
| 2026-04-02 | Paige Pantlin | assigned shifts: 18:00:00-22:00:00 bar scheduled (Thursday Close) | Child illness/doctor appointment. | WhatsApp FOH 2026-04-02: Asked cover for 18:00-22:00 because taking son to doctors, really unwell. | markEmployeeCouldntWork week_id=21448cb5-b632-400c-9f9b-56d609667c1b |
| 2026-04-11 | Niamh Woods | assigned shifts: 12:00:00-18:00:00 bar scheduled (Saturday Open) | Vomiting / not well enough to work. | employee note + WhatsApp FOH 2026-04-11: Up through night throwing up; not well enough for today; group confirmed Niamh scheduled today and tomorrow. | markEmployeeCouldntWork week_id=f8e73d4e-3a9d-4c50-9a48-463408304689 |
| 2026-04-12 | Niamh Woods | assigned shifts: 12:00:00-17:00:00 bar scheduled (Sunday Open) | Vomiting / sickness carried into next scheduled day. | employee note + WhatsApp FOH 2026-04-11: Same illness; group confirmed Niamh was scheduled tomorrow and cover was needed for Sunday lunches. | markEmployeeCouldntWork week_id=f8e73d4e-3a9d-4c50-9a48-463408304689 |
| 2026-05-03 | Lance Marlow | assigned shifts: 17:00:00-22:00:00 bar scheduled (Sunday Close) | Unable to close; illness implied. | WhatsApp FOH 2026-05-03/04: Lance was not able to work the close 17:00-22:00; following message says hope he is feeling better. | markEmployeeCouldntWork week_id=d8aa9e2c-aeb6-479f-b3ae-11933ea39dd0 |
| 2026-05-07 | Paige Pantlin | no current assigned shift row | Unwell; cover requested for 18:00-22:00. | WhatsApp FOH 2026-05-07: Asked cover for 18:00-22:00 at short notice because really unwell. | markEmployeeCouldntWork week_id=127382ca-3753-41dd-a4a1-52f575599c7f |
| 2026-05-10 | Niamh Woods | no current assigned shift row | Travel/time conflict after wedding; not back for Sunday shift. | WhatsApp FOH 2026-04-30: Asked cover for Sunday 10th 12:00-17:00 because wedding previous day and would not be back in time. | markEmployeeCouldntWork week_id=127382ca-3753-41dd-a4a1-52f575599c7f |

## Manual Review

| Date | Employee | Current rota evidence | Reason to store | Source/evidence | Proposed DB action |
|---|---|---|---|---|---|
| 2025-02-28 | Jazz Forsey | assigned shifts: 18:00:00-21:00:00 bar scheduled | Availability conflict; only partial cover needed after 21:00. | WhatsApp FOH 2025-02-06: Could not work full 28 Feb shift due BA roster next day; agreed she could do until 21:00 and Jamie last half. | manual decision before import |
| 2025-06-21 | Jamie Chaplin | assigned shifts: 18:00:00-00:00:00 bar scheduled | Felt awful/headache; partial shift / left mid-shift. | WhatsApp FOH and employee notes 2025-06-21: Asked for cover from 21:00-00:00 because he felt awful; later left mid-shift after dispute. | manual decision before import |
| 2025-08-08 | Maria Gurtatowska | assigned shifts: 18:00:00-00:00:00 bar scheduled | Sick in pub; sent home mid-shift. | employee note 2025-08-18: Was sick in pub Friday 8 Aug and sent home. | manual decision before import |
| 2025-09-27 | Jordan Bowman | assigned shifts: 18:00:00-00:00:00 bar scheduled | No pragmatic reason recorded. | WhatsApp FOH 2025-09-21/24: Asked cover for 27 September 18:00-00:00; no reason given in export. | manual decision before import |
| 2026-04-05 | Harry Jefferyes | assigned shifts: 17:00:00-22:00:00 bar scheduled (Sunday Close) | No reason recorded and date wording ambiguous. | WhatsApp FOH 2026-04-01: Asked for cover for Sunday 5, 17:00-22:00; message said “May” but date context makes Sunday 5 April likely; no reason recorded. | manual decision before import |
| 2026-04-06 | Amanda Jones | assigned shifts: 18:00:00-22:00:00 bar scheduled (Monday Close); 14:00:00-18:00:00 bar scheduled (Monday Open) | Child sickness; partial Bank Holiday shift only. | employee note 2026-04-06: Could not do all of Bank Holiday because Adele was not well; Ryan did the close. | manual decision before import |
| 2026-05-08 | Harry Jefferyes | assigned shifts: 19:00:00-22:00:00 bar scheduled (Friday Close) | No reason recorded; late-notice cover request. | WhatsApp FOH 2026-05-08: Asked cover for shift this evening 19:00-22:00 at late notice; Ryan could make 20:00. | manual decision before import |

## Skip

| Date | Employee | Current rota evidence | Reason to store | Source/evidence | Proposed DB action |
|---|---|---|---|---|---|
| 2025-06-13 | Sean Low | no current assigned shift row | Already working elsewhere after resignation context. | employee note 2025-06-11: Asked if he could work Friday to cover a shift he was meant to work; he could not because already working elsewhere. | do not import |
| 2025-09-07 | Jordan Bowman | assigned shifts: 12:00:00-17:00:00 bar scheduled (Sunday Open) | Late arrival only; not a whole could-not-work day. | WhatsApp FOH 2025-09-07: Asked cover for one hour; would arrive at 13:00 instead of 12:00. | do not import |

## Already Present

| Date | Employee | Current rota evidence | Reason to store | Source/evidence | Proposed DB action |
|---|---|---|---|---|---|
| 2026-05-23 | Niamh Woods | already sick row: 0db93612-87e4-4b86-b979-2a72f59faddc | Sister had a baby and baby is not well; needed to be with her. | existing audit/rota row 2026-05-22: Already marked Couldn't Work in rota. | no import |
| 2026-05-24 | Niamh Woods | already sick row: bb8caed0-71ff-488a-bd15-801a454738f8 | Sister had a baby and baby is not well; needed to be with her. | existing audit/rota row 2026-05-22: Already marked Couldn't Work in rota. | no import |
