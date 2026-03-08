# Comprehensive Review Checklist

Use this checklist when writing agent briefs. Not every item applies to every section — select the ones relevant to the target section and include them in each agent's brief.

## User-Facing Flows
- [ ] Creation/submission flow
- [ ] Editing/amendment flow
- [ ] Deletion/removal flow
- [ ] Cancellation flow
- [ ] Search and filtering
- [ ] Viewing/detail pages
- [ ] Confirmation and feedback screens
- [ ] Error states and error messages

## Business Rules and Logic
- [ ] Pricing and calculation rules
- [ ] Eligibility and validation rules
- [ ] Threshold and boundary rules (group sizes, minimums, maximums)
- [ ] Exception rules and overrides
- [ ] Time-based rules (deadlines, windows, schedules)
- [ ] Status transitions and lifecycle rules
- [ ] Permission and role-based rules

## Payments and Financial
- [ ] Payment initiation
- [ ] Payment capture/confirmation
- [ ] Payment tracking and reconciliation
- [ ] Refund handling
- [ ] Deposit rules
- [ ] Partial payment handling
- [ ] Payment failure and retry
- [ ] Financial reporting accuracy
- [ ] Currency and rounding

## Communications
- [ ] SMS message content and triggers
- [ ] Email content and triggers
- [ ] Push notification content and triggers
- [ ] In-app notification content and triggers
- [ ] Confirmation messages
- [ ] Reminder messages
- [ ] Cancellation/change messages
- [ ] Language accuracy (does copy match current business rules?)

## Admin and Internal
- [ ] Admin CRUD operations
- [ ] Status management
- [ ] Override and manual intervention capabilities
- [ ] Reporting and analytics accuracy
- [ ] Search and filtering in admin
- [ ] Bulk operations
- [ ] Export functionality
- [ ] Audit trail and history

## Data Integrity
- [ ] Required fields enforced
- [ ] Foreign key relationships maintained
- [ ] Orphaned records prevention
- [ ] Duplicate prevention
- [ ] Cascade delete/update behavior
- [ ] Data consistency across related entities
- [ ] Soft delete vs hard delete clarity
- [ ] Timestamp accuracy (created, updated, deleted)

## Integration and External Services
- [ ] API contract adherence
- [ ] Webhook handling (receipt, validation, idempotency)
- [ ] Timeout handling
- [ ] Retry logic
- [ ] Circuit breaker or fallback behavior
- [ ] Rate limiting awareness
- [ ] Authentication and authorization with external services
- [ ] Data synchronization

## Error Handling and Edge Cases
- [ ] Network failures
- [ ] Partial operation failures (what happens mid-transaction?)
- [ ] Concurrent modification handling
- [ ] Null/missing data handling
- [ ] Invalid input handling
- [ ] Service unavailability
- [ ] Race conditions
- [ ] Timeout scenarios
- [ ] Duplicate submission prevention

## Security and Permissions
- [ ] Authentication requirements
- [ ] Authorization checks on every endpoint
- [ ] Input sanitization
- [ ] SQL injection prevention
- [ ] XSS prevention
- [ ] CSRF protection
- [ ] Rate limiting
- [ ] Sensitive data handling (PII, payment info)
- [ ] Role-based access control

## Performance and Scalability
- [ ] Database query efficiency (N+1 queries, missing indexes)
- [ ] Pagination for list endpoints
- [ ] Caching strategy
- [ ] Background job handling for heavy operations
- [ ] Connection pooling
- [ ] Memory management

## Code Quality
- [ ] Consistent patterns and conventions
- [ ] Adequate logging for production debugging
- [ ] Test coverage (unit, integration)
- [ ] Dead code and unused imports
- [ ] TODO/FIXME/HACK comments (these are admissions of known debt)
- [ ] Hardcoded values that should be configurable
- [ ] Magic numbers without explanation
- [ ] Error messages that help diagnose the problem
