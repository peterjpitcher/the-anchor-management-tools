# Documentation Subfolders Index

This document provides an overview of all subdirectories within the `/docs` folder, their contents, and recommendations for preservation or consolidation.

## Directory Structure and Recommendations

### 1. audit-reports/ ✅ **PRESERVE**
**Contents:** Comprehensive system audit reports and phase-by-phase analysis
- `comprehensive-audit-report.md` - Full system audit findings
- `executive-summary.md` - High-level summary for stakeholders
- `issue-tracker.md` - Tracked issues from audit
- `phase0-environment-validation.md` through `phase5-business-logic.md` - Detailed phase reports
- `priority-roadmap.md` - Action items prioritized by severity

**Recommendation:** Keep as historical reference and baseline for future audits. These documents provide valuable context for understanding past system states and improvements made.

### 2. implementation-guides/ ✅ **PRESERVE**
**Contents:** Specific implementation guides for various features
- `gdpr-compliance-implementation.md` - GDPR compliance steps
- `monitoring-setup.md` - System monitoring configuration
- `rate-limiting-implementation.md` - Rate limiting setup
- `validation-fixes.md` - Validation issue resolutions

**Recommendation:** Keep as reference documentation. These are detailed implementation guides that complement the high-level documentation in CONTRIBUTING.md and are valuable for specific feature implementations.

### 3. loyalty-program/ ✅ **PRESERVE**
**Contents:** Comprehensive loyalty program documentation and planning
- `DEMO_README.md` - Demo instructions
- `anchor-vips-enhanced-prd.md` - Enhanced product requirements
- `anchor-vips-program-brief.md` - Program overview
- `detailed-implementation-timeline.md` - Implementation schedule
- `event-based-achievements-and-challenges.md` - Gamification features
- `future-state-loyalty-program.md` - Future enhancements
- `implementation-discovery-report.md` - Technical discovery
- `loyalty-program-research-and-recommendations.md` - Research findings
- `technical-capabilities-and-implementation-plan.md` - Technical plan

**Recommendation:** Keep as feature-specific documentation. This represents significant product planning work and will be essential when implementing the loyalty program feature.

### 4. ui-audit/ ✅ **PRESERVE**
**Contents:** Comprehensive UI/UX audit with 15+ detailed reports
- `00-complete-issues-list.md` - All identified issues
- `01-current-state-analysis.md` through `15-week5-6-progress-report.md` - Detailed analysis
- `README.md` - Audit overview

**Recommendation:** Keep as reference for UI consistency and design decisions. The audit provides valuable baseline documentation and progress tracking that shouldn't be lost.

### 5. security/ ❌ **CONSOLIDATE**
**Contents:** Single file about event access security
- `event-access.md` - Event access security documentation

**Recommendation:** Merge into SECURITY.md. This single file can be incorporated into the main security documentation under an "Event Access Security" section.

### 6. user-flows/ ❌ **CONSOLIDATE**
**Contents:** Single user flow documentation
- `private-bookings-flow.md` - Private bookings user journey

**Recommendation:** Merge into FEATURES.md under the "Private Bookings" section. This provides valuable context for the feature that should be in the main feature documentation.

### 7. sms-templates/ ✅ **PRESERVE**
**Contents:** Exported SMS template configurations (JSON files)
- 5 exported JSON files from Zapier

**Recommendation:** Keep as data files. These are not documentation but actual configuration exports that may be needed for system restoration or migration.

### 8. tests/ ✅ **PRESERVE**
**Contents:** Test-related directories
- `auth/` - Authentication test files
- `screenshots/` - Test screenshots

**Recommendation:** Keep as part of test infrastructure. These support the testing framework and should remain with test documentation.

### 9. api/ ✅ **PRESERVE**
**Contents:** API documentation
- `README.md` - API overview
- `error-codes.md` - Error code reference
- `rest-api.md` - REST API documentation
- `table-bookings.md` - Table bookings API docs
- `webhooks.md` - Webhook documentation

**Recommendation:** Keep as dedicated API documentation. This is well-organized technical documentation that developers need.

## Summary of Actions

### Directories to Preserve:
- ✅ `/audit-reports` - Historical audit reference
- ✅ `/implementation-guides` - Detailed implementation references
- ✅ `/loyalty-program` - Feature-specific product documentation
- ✅ `/ui-audit` - UI/UX baseline and progress tracking
- ✅ `/sms-templates` - Configuration data files
- ✅ `/tests` - Test infrastructure support
- ✅ `/api` - Technical API documentation

### Directories to Consolidate:
- ❌ `/security` - Merge `event-access.md` into `SECURITY.md`
- ❌ `/user-flows` - Merge `private-bookings-flow.md` into `FEATURES.md`

## Rationale for Preservation

The preserved directories contain:
1. **Historical Context**: Audit reports provide baseline understanding
2. **Detailed Implementations**: Guides that complement high-level docs
3. **Product Planning**: Significant work on future features
4. **Technical References**: API docs and configuration files
5. **Progress Tracking**: UI audit shows evolution of design system

This structure maintains a clear separation between:
- High-level documentation (root `/docs` files)
- Detailed references and historical context (subdirectories)
- Technical/API documentation (`/api` directory)
- Feature-specific planning (`/loyalty-program`)

## Next Steps

1. Merge `/security/event-access.md` content into `SECURITY.md`
2. Merge `/user-flows/private-bookings-flow.md` content into `FEATURES.md`
3. Remove the now-empty `/security` and `/user-flows` directories
4. Update this index if new subdirectories are added