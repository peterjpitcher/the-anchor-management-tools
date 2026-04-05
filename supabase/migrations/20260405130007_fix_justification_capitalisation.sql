-- Fix justification capitalisation and consistency

-- Delete leaked header rows (justification = 'Justification')
DELETE FROM public.expenses WHERE justification = 'Justification';

-- Case fixes — lowercase → Title Case
UPDATE public.expenses SET justification = 'Cleaner' WHERE justification = 'cleaner';
UPDATE public.expenses SET justification = 'Groceries' WHERE justification = 'groceries';
UPDATE public.expenses SET justification = 'Host' WHERE justification = 'host';
UPDATE public.expenses SET justification = 'Costume' WHERE justification = 'costume';
UPDATE public.expenses SET justification = 'DJ' WHERE justification = 'dj';
UPDATE public.expenses SET justification = 'Game Show' WHERE justification = 'game show';
UPDATE public.expenses SET justification = 'Quiz Night' WHERE justification = 'quiz night';
UPDATE public.expenses SET justification = 'Quiz Night' WHERE justification = 'Quiz night';
UPDATE public.expenses SET justification = 'Bingo Tickets' WHERE justification = 'bingo tickets';
UPDATE public.expenses SET justification = 'Bread' WHERE justification = 'bread';
UPDATE public.expenses SET justification = 'Mouse' WHERE justification = 'mouse';
UPDATE public.expenses SET justification = 'Sweets' WHERE justification = 'sweets';
UPDATE public.expenses SET justification = 'Make Up' WHERE justification = 'make up';
UPDATE public.expenses SET justification = 'Polish' WHERE justification = 'Polish';

-- Sentence case fixes for longer descriptions
UPDATE public.expenses SET justification = 'Art for Bits Quiz Night' WHERE justification = 'art for bits  quiz night';
UPDATE public.expenses SET justification = 'DJ Deposit for Halloween and New Year''s Eve' WHERE justification = 'dj deposit for halloween and new yr eve';
UPDATE public.expenses SET justification = 'Game Show Paid by Bank Transfer' WHERE justification = 'game show paid by bank trans';
UPDATE public.expenses SET justification = 'Gameshow Prizes' WHERE justification = 'gameshow prizes';
UPDATE public.expenses SET justification = 'Gameshow Host' WHERE justification = 'Gameshow host';
UPDATE public.expenses SET justification = 'Halloween Decorations' WHERE justification = 'halloween dec';
UPDATE public.expenses SET justification = 'High Heels House Party' WHERE justification = 'high heels house party';
UPDATE public.expenses SET justification = 'High Heels House Party Game Show' WHERE justification = 'high heels house party game show';
UPDATE public.expenses SET justification = 'Jumbo Playing Cards' WHERE justification = 'jumbo playing cards';
UPDATE public.expenses SET justification = 'Kitchen Hand Temp Help' WHERE justification = 'Kitchen hand temp help';
UPDATE public.expenses SET justification = 'Lance Halloween Decorations' WHERE justification = 'Lance Halloween dec pub';
UPDATE public.expenses SET justification = 'Meal Meeting' WHERE justification = 'meal out meeting';
UPDATE public.expenses SET justification = 'Mixer Tap' WHERE justification = 'mixer tap';
UPDATE public.expenses SET justification = 'Prizes for High Heels House Party' WHERE justification = 'prizes for high heels house party';
UPDATE public.expenses SET justification = 'Prizes for Nikki' WHERE justification = 'Prizes for nikki';
UPDATE public.expenses SET justification = 'Pub Research Menu Layout Food' WHERE justification = 'pub research menu layout food';
UPDATE public.expenses SET justification = 'Rainbow Foil Curtains' WHERE justification = 'Rainbow foil curtains';
UPDATE public.expenses SET justification = 'Receipts Forgot to Add' WHERE justification = 'receipts forgot to add';
UPDATE public.expenses SET justification = 'Stock Take and Groceries' WHERE justification = 'stock take  and Groceries';
UPDATE public.expenses SET justification = 'Team Meal Out' WHERE justification = 'team meal out';
UPDATE public.expenses SET justification = 'Washing Up Liquid' WHERE justification = 'washing up liquid';
UPDATE public.expenses SET justification = 'Weeding Fix Fence' WHERE justification = 'weeding fix fence';
UPDATE public.expenses SET justification = 'Window Decorations' WHERE justification = 'Window Dec';
UPDATE public.expenses SET justification = 'Christmas Decorations' WHERE justification = 'xmas dec';
UPDATE public.expenses SET justification = 'Working Dinner' WHERE justification = 'working dinner';
UPDATE public.expenses SET justification = 'Fitting New Parts' WHERE justification = 'fitting new parts';
UPDATE public.expenses SET justification = 'Double Sided Tape' WHERE justification = 'Double sided tape';
UPDATE public.expenses SET justification = 'Balloons Party Poppers' WHERE justification = 'Ballons Party poppers';
UPDATE public.expenses SET justification = 'Stationery' WHERE justification = 'Stationary';
UPDATE public.expenses SET justification = 'Kitchenware' WHERE justification = 'Kitchenwear';
UPDATE public.expenses SET justification = 'Host for DHL' WHERE justification = 'Host for DHL';
UPDATE public.expenses SET justification = 'Gardening and Car Park Tidy' WHERE justification = 'Gardening and car park tidy';
UPDATE public.expenses SET justification = 'Fixing Gate and Fence Posts' WHERE justification = 'Fixing gate and f posts';
