# Employee Onboarding Portal - Product Requirements Document

## Executive Summary

The Employee Onboarding Portal is a web-based application that allows new employees of The Anchor to complete their onboarding process digitally. This includes providing personal information, emergency contacts, bank details, right to work documentation, health information, and electronically signing employment agreements.

## Problem Statement

Currently, new employee onboarding requires manual paperwork, in-person document verification, and administrative overhead. This process is:
- Time-consuming for both HR and new employees
- Prone to errors and missing information
- Difficult to track completion status
- Requires physical storage of documents

## Solution Overview

A secure, user-friendly web portal that:
- Guides new employees through the onboarding process step-by-step
- Validates information in real-time
- Allows document uploads for right to work verification
- Provides electronic signature capabilities
- Integrates with existing employee management system
- Automates administrative tasks (WhenIWork invites, WhatsApp group additions, etc.)

## Key Features

### 1. Public Onboarding Portal
- **Unique Access Links**: Each new employee receives a unique, time-limited link
- **Mobile-Responsive**: Works on all devices
- **Progress Tracking**: Shows completion status for each section
- **Save & Resume**: Ability to save progress and return later

### 2. Information Collection Forms

#### Personal Information
- Full name, address, contact details
- Date of birth, NI number
- Form validation for UK formats (postcodes, phone numbers, NI numbers)

#### Emergency Contacts
- Primary and secondary contact details
- Relationship to employee
- Multiple phone numbers per contact

#### Bank Details
- Bank account information for payroll
- Phonetic spelling fields for verification
- Secure handling of sensitive financial data

#### Right to Work
- Document type selection (List A or List B)
- Photo upload capability for documents
- Clear instructions on acceptable documents
- Expiry date tracking for time-limited permissions

#### Health Information
- Medical contact details
- Health questionnaire with conditional logic
- Disability registration details
- Allergen awareness acknowledgment

### 3. Digital Agreement Features

#### Staff Handbook Acknowledgment
- Display full handbook content
- Section-by-section confirmation checkboxes
- Special emphasis on zero-tolerance policies
- Quiz or confirmation questions for critical policies

#### Electronic Signature
- Legal name entry
- Date/time stamp
- IP address logging
- PDF generation of signed documents

### 4. Administrative Dashboard

#### Onboarding Status Overview
- List of pending onboardings
- Progress tracking per employee
- Alerts for incomplete submissions
- Document verification status

#### Employee Record Creation
- Automatic population of employee records
- Integration with existing employee management system
- Checklist for manual tasks (WhenIWork setup, WhatsApp groups, etc.)

#### Document Management
- Secure storage of uploaded documents
- Right to work expiry alerts
- Audit trail of all submissions and changes

## Technical Requirements

### Security & Compliance
- GDPR compliant data handling
- Encrypted data transmission (HTTPS)
- Secure document storage
- Access control and authentication
- Audit logging of all actions
- Data retention policies

### Integration Points
- Existing employee management system
- Document storage (Supabase Storage)
- Email notifications
- SMS verification (optional)
- PDF generation for agreements

### Performance Requirements
- Page load time < 3 seconds
- Support for file uploads up to 10MB
- Concurrent user support
- 99.9% uptime

## User Experience

### New Employee Journey
1. Receive email with unique onboarding link
2. Create temporary password
3. Complete sections in order (with ability to save)
4. Upload required documents
5. Review all information
6. Read and acknowledge policies
7. Electronically sign agreement
8. Receive confirmation email with next steps

### Admin Journey
1. Create new employee onboarding request
2. System generates and sends unique link
3. Monitor progress through dashboard
4. Verify uploaded documents
5. Complete manual setup tasks
6. Mark onboarding as complete

## Success Metrics
- Time to complete onboarding (target: < 30 minutes)
- Completion rate (target: > 95%)
- Error rate in submitted information
- Admin time saved per onboarding
- Document verification turnaround time

## Future Enhancements
- Integration with WhenIWork API for automatic account creation
- Automated WhatsApp group additions
- Digital ID verification services
- Multi-language support
- Video introduction from management

---

## Clarifying Questions

Before proceeding with implementation, I need clarification on the following:

### 1. Access & Authentication
- How should new employees receive their onboarding links? (Email, SMS, both?)
- Should links expire? If so, after how long?
- Do we need two-factor authentication for sensitive sections?
- Should employees create a password, or use a one-time access system?

### 2. Document Handling
- For right to work documents, do we need real-time verification or is upload sufficient?
- Should we integrate with any third-party ID verification services?
- What's the maximum file size we should support for uploads?
- Do we need to support multiple file formats (PDF, JPG, PNG)?

### 3. Integration Requirements
- Should this integrate with the existing employee management system immediately, or can it be a standalone system initially?
- Do we have API access to WhenIWork for automatic account creation?
- Are there any other systems (payroll, HR) that need integration?

### 4. Compliance & Legal
- Are there specific UK employment law requirements for electronic signatures?
- How long should we retain onboarding documents?
- Do we need witness signatures for any agreements?
- Should we generate a PDF copy of the completed agreement for the employee?

### 5. Workflow & Automation
- Which steps require manual admin approval before proceeding?
- Should the system automatically notify admins when action is needed?
- Can some verifications be automated (e.g., bank account validation)?
- Should incomplete applications send reminder emails? After how long?

### 6. User Experience
- Should the portal support saving partial progress?
- Do we need to support users who don't have email addresses?
- Should there be a preview/review step before final submission?
- How should we handle users who need to update information after submission?

### 7. Edge Cases
- What happens if someone starts but doesn't complete the process?
- How do we handle employees who don't have UK bank accounts?
- What about employees who can't provide digital copies of documents?
- How should we handle technical issues during submission?

### 8. Rollout Strategy
- Should we pilot with a small group first?
- Do we need to maintain the paper process in parallel initially?
- How will existing employees access their agreements?
- Should HR staff have training before launch?

### 9. Branding & Communication
- Should the portal match The Anchor's branding?
- What tone should the instructions use (formal, friendly, etc.)?
- Do we need multiple notification templates?
- Should there be a help/support option within the portal?

### 10. Data Migration
- Do we need to digitize existing employee records?
- Should current employees be able to update their information through this portal?
- How do we handle employees who were onboarded with the old process?

Please provide answers to these questions so I can refine the PRD and begin implementation planning.