# Contributing to Anchor Management Tools

Welcome to the Anchor Management Tools project! This guide will help you get started with contributing to our comprehensive venue management system. We appreciate your interest in improving our application.

## Table of Contents

1. [Getting Started](#getting-started)
2. [Development Environment Setup](#development-environment-setup)
3. [Code Style and Standards](#code-style-and-standards)
4. [UI/UX Guidelines](#uiux-guidelines)
5. [Git Workflow and Branching Strategy](#git-workflow-and-branching-strategy)
6. [Pull Request Process](#pull-request-process)
7. [Code Review Guidelines](#code-review-guidelines)
8. [Documentation Requirements](#documentation-requirements)
9. [Testing Requirements](#testing-requirements)
10. [Security Guidelines](#security-guidelines)
11. [Performance Standards](#performance-standards)

## Getting Started

Before contributing, please:

1. Read our [CLAUDE.md](../CLAUDE.md) for project-specific patterns and conventions
2. Review existing code to understand our patterns
3. Check the [docs](./docs) directory for detailed technical documentation
4. Join our development discussions (if applicable)

### Quick Start

```bash
# Clone the repository
git clone https://github.com/your-org/anchor-management-tools.git
cd anchor-management-tools

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env.local
# Edit .env.local with your development credentials

# Run the development server
npm run dev
```

The application will be available at http://localhost:3000.

## Development Environment Setup

### Prerequisites

- Node.js 18+ (use Node.js 20 for best compatibility)
- npm or yarn
- Git
- A Supabase account (for database)
- A Twilio account (for SMS testing)
- A code editor (VS Code recommended)

### Required Environment Variables

Create a `.env.local` file with the following variables:

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Twilio
TWILIO_ACCOUNT_SID=your_account_sid
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_PHONE_NUMBER=your_twilio_number

# Application
NEXT_PUBLIC_APP_URL=http://localhost:3000
CRON_SECRET=your_cron_secret
NEXT_PUBLIC_CONTACT_PHONE_NUMBER=+447700900123

# Optional (for production features)
MICROSOFT_GRAPH_CLIENT_ID=your_client_id
MICROSOFT_GRAPH_CLIENT_SECRET=your_client_secret
MICROSOFT_GRAPH_TENANT_ID=your_tenant_id
```

### VS Code Extensions

We recommend installing these extensions:

- ESLint
- Prettier
- Tailwind CSS IntelliSense
- TypeScript Vue Plugin (Volar)
- Prisma (for database schema)

### Database Setup

1. Create a new Supabase project
2. Run the migrations in order:
   ```bash
   # Check migration health
   ./supabase/verify-migrations.sh
   
   # Apply migrations
   supabase db push
   ```

## Code Style and Standards

### TypeScript

We use TypeScript with strict mode enabled. Follow these guidelines:

```typescript
// ✅ Good - Use interfaces for object types
interface Employee {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

// ❌ Bad - Avoid 'any' type
function processData(data: any) {
  // ...
}

// ✅ Good - Define explicit types
function getEmployee(id: string): Promise<Employee> {
  // Implementation
}

// ✅ Good - Use proper error handling
export async function updateEmployee(id: string, data: Partial<Employee>) {
  try {
    const result = await supabase
      .from('employees')
      .update(data)
      .eq('id', id)
      .select()
      .single();
      
    if (result.error) throw result.error;
    return { success: true, data: result.data };
  } catch (error) {
    console.error('Failed to update employee:', error);
    return { success: false, error: error.message };
  }
}
```

### React Components

```typescript
// ✅ Good - Functional component with proper typing
interface EmployeeCardProps {
  employee: Employee;
  onEdit?: (id: string) => void;
  className?: string;
}

export function EmployeeCard({ employee, onEdit, className }: EmployeeCardProps) {
  return (
    <div className={cn("bg-white shadow sm:rounded-lg", className)}>
      {/* Component content */}
    </div>
  );
}

// ✅ Good - Handle loading and error states
export function EmployeeList() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);

  // Implementation
}
```

### File Organization

```
src/
├── app/                    # Next.js app directory
│   ├── (authenticated)/    # Protected routes
│   ├── actions/           # Server actions
│   └── api/              # API routes
├── components/           # Reusable components
│   ├── ui/              # Base UI components
│   └── providers/       # React context providers
├── lib/                 # Utilities and helpers
├── types/              # TypeScript type definitions
└── contexts/           # Application contexts
```

### Naming Conventions

- **Components**: PascalCase (`EmployeeCard.tsx`)
- **Utilities**: camelCase (`formatDate.ts`)
- **Types/Interfaces**: PascalCase (`Employee`, `Database`)
- **Constants**: UPPER_SNAKE_CASE (`MAX_FILE_SIZE`)
- **CSS Classes**: Use Tailwind classes (no custom CSS unless necessary)

### Server Actions Pattern

Always use server actions for data mutations:

```typescript
'use server';

import { createClient } from '@/lib/supabase/server';
import { checkUserPermission } from '@/app/actions/rbac';
import { logAuditEvent } from '@/app/actions/audit';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';

// Define validation schema
const CreateEntitySchema = z.object({
  name: z.string().min(1, 'Name is required'),
  // ... other fields
});

export async function createEntity(formData: FormData) {
  try {
    // 1. Get authenticated client
    const supabase = await createClient();
    
    // 2. Check permissions
    const hasPermission = await checkUserPermission('module_name', 'create');
    if (!hasPermission) {
      return { error: 'You do not have permission to perform this action' };
    }
    
    // 3. Validate input
    const validatedData = CreateEntitySchema.parse({
      name: formData.get('name'),
      // ... other fields
    });
    
    // 4. Perform database operation
    const { data, error } = await supabase
      .from('table_name')
      .insert(validatedData)
      .select()
      .single();
      
    if (error) {
      console.error('Database error:', error);
      return { error: 'Failed to create entity' };
    }
    
    // 5. Log audit event
    await logAuditEvent(supabase, {
      action: 'create',
      entity_type: 'entity_name',
      entity_id: data.id,
      details: { name: data.name }
    });
    
    // 6. Revalidate cache
    revalidatePath('/entity-list');
    
    return { success: true, data };
  } catch (error) {
    console.error('Server action error:', error);
    return { error: 'An unexpected error occurred' };
  }
}
```

## UI/UX Guidelines

### Design Principles

1. **Consistency First**: Use established patterns throughout
2. **Mobile-First**: Design for mobile, enhance for desktop
3. **Accessibility**: WCAG 2.1 AA compliant
4. **Performance**: Lightweight components, minimal JavaScript
5. **Clear Visual Hierarchy**: Users should instantly understand importance

### Color System

```css
/* Primary Colors - ALWAYS USE THESE */
--primary-green: #16a34a;     /* green-600 - Primary actions */
--primary-green-dark: #15803d; /* green-700 - Hover states */
--focus-green: #22c55e;        /* green-500 - Focus rings */

--link-blue: #2563eb;          /* blue-600 - Links only */
--link-blue-dark: #1e3a8a;     /* blue-900 - Link hover */

--sidebar-green: #005131;      /* Navigation sidebar */

/* Status Colors */
--success: #10b981;            /* Success messages */
--warning: #f59e0b;            /* Warnings */
--error: #ef4444;              /* Errors */
```

**Important**: NO INDIGO COLORS - Replace all indigo with green/blue palette

### Component Usage

Use our standardized components from `@/components/ui/`:

```tsx
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';

// Primary button (green)
<Button>Save Changes</Button>

// Secondary button
<Button variant="secondary">Cancel</Button>

// Destructive button (red)
<Button variant="destructive">Delete</Button>
```

### Responsive Design

- **Mobile First**: Build for mobile, enhance for desktop
- **Breakpoints**: `sm:640px`, `md:768px`, `lg:1024px`, `xl:1280px`
- **Touch Targets**: Minimum 44x44px
- **Test on Real Devices**: Don't rely only on browser DevTools

### Accessibility Requirements

- All interactive elements must be keyboard accessible
- Use semantic HTML elements
- Provide proper ARIA labels
- Maintain 4.5:1 color contrast ratio for text
- Include focus indicators on all interactive elements
- Test with screen readers

## Git Workflow and Branching Strategy

### Branch Naming

```
main              # Production code
├── develop       # Development integration
└── feature/*     # Feature branches
    fix/*         # Bug fixes
    hotfix/*      # Urgent production fixes
    chore/*       # Maintenance tasks
```

### Branch Naming Examples

- `feature/add-customer-export`
- `fix/sms-delivery-issue`
- `hotfix/booking-capacity-bug`
- `chore/update-dependencies`

### Commit Messages

Follow conventional commits format:

```
<type>(<scope>): <subject>

<body>

<footer>
```

Types:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code refactoring
- `test`: Adding tests
- `chore`: Maintenance tasks

Examples:
```
feat(customers): add CSV export functionality

- Add export button to customer list
- Implement CSV generation with all customer fields
- Include proper date formatting

Closes #123
```

```
fix(sms): resolve delivery issue for UK numbers

- Fix phone number formatting for +44 prefix
- Add validation for E.164 format
- Update error messages

Fixes #456
```

## Pull Request Process

### Before Creating a PR

1. **Run Discovery Protocol** (MANDATORY):
   ```bash
   # Run the discovery script
   npm run discovery
   
   # Check the generated report
   cat discovery-*.log
   ```

2. **Ensure Code Quality**:
   ```bash
   # Run linting
   npm run lint
   
   # Build the project
   npm run build
   
   # Run tests (if available)
   npm test
   ```

3. **Test Your Changes**:
   - Test all user roles (super_admin, manager, staff)
   - Test on mobile devices
   - Test error scenarios
   - Verify audit logs are created

### Creating the PR

1. **Create Feature Branch**:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make Your Changes**:
   - Follow code standards
   - Include proper error handling
   - Add loading states
   - Update types if needed

3. **Commit Your Changes**:
   ```bash
   git add .
   git commit -m "feat: implement new feature"
   ```

4. **Push to GitHub**:
   ```bash
   git push origin feature/your-feature-name
   ```

5. **Create Pull Request**:
   - Use a descriptive title
   - Fill out the PR template
   - Link related issues
   - Add screenshots for UI changes

### PR Template

```markdown
## Description
Brief description of what this PR does.

## Type of Change
- [ ] Bug fix (non-breaking change)
- [ ] New feature (non-breaking change)
- [ ] Breaking change
- [ ] Documentation update

## Checklist
- [ ] I have run the discovery protocol
- [ ] My code follows the project style guidelines
- [ ] I have performed a self-review
- [ ] I have added tests (if applicable)
- [ ] I have updated documentation
- [ ] My changes generate no new warnings
- [ ] I have tested with all user roles
- [ ] I have tested on mobile devices

## Screenshots (if applicable)
Add screenshots here for UI changes.

## Additional Notes
Any additional information reviewers should know.
```

## Code Review Guidelines

### For Reviewers

1. **Check Code Quality**:
   - TypeScript types are proper
   - No `any` types without justification
   - Error handling is comprehensive
   - Loading states are present

2. **Verify Patterns**:
   - Server actions used for mutations
   - Permissions checked properly
   - Audit events logged
   - Consistent with existing code

3. **Test the Changes**:
   - Pull the branch locally
   - Test happy path
   - Test error scenarios
   - Verify mobile responsiveness

4. **Provide Constructive Feedback**:
   - Be specific about issues
   - Suggest improvements
   - Acknowledge good practices
   - Ask questions if unclear

### For Contributors

1. **Respond Promptly**: Address feedback within 2-3 business days
2. **Be Open**: Accept constructive criticism gracefully
3. **Ask Questions**: If feedback is unclear, ask for clarification
4. **Update Thoroughly**: Make all requested changes before re-review

## Documentation Requirements

### Code Documentation

```typescript
/**
 * Updates an employee's information in the database
 * 
 * @param employeeId - The unique identifier of the employee
 * @param data - Partial employee data to update
 * @returns Promise with success status and updated data or error
 * 
 * @example
 * const result = await updateEmployee('123', { firstName: 'John' });
 * if (result.success) {
 *   console.log('Updated:', result.data);
 * }
 */
export async function updateEmployee(
  employeeId: string,
  data: Partial<Employee>
): Promise<ActionResult<Employee>> {
  // Implementation
}
```

### When to Update Documentation

Update documentation when you:
- Add new features
- Change existing APIs
- Modify database schema
- Update environment variables
- Change deployment process
- Add new dependencies

### Documentation Locations

- **API Documentation**: `/docs/api/`
- **Database Schema**: `/docs/database-documentation.md`
- **Feature Guides**: `/docs/feature-*.md`
- **UI Standards**: `/docs/ui-standards-comprehensive-*.md`

## Testing Requirements

### Manual Testing Checklist

Before submitting your PR, test:

- [ ] Feature works as expected
- [ ] All CRUD operations work
- [ ] Mobile layout is correct
- [ ] Errors are handled gracefully
- [ ] Loading states show properly
- [ ] Form validation works
- [ ] Database updates correctly
- [ ] SMS sends properly (if applicable)
- [ ] File uploads work (if applicable)
- [ ] Permissions are enforced

### Testing with Different Roles

Test your feature with each role:

1. **Super Admin**: Full access to everything
2. **Manager**: Limited administrative access
3. **Staff**: Basic operational access

### Browser Testing

Test in:
- Chrome (latest)
- Firefox (latest)
- Safari (latest)
- Mobile browsers (iOS Safari, Chrome Android)

## Security Guidelines

### Input Validation

Always validate user input:

```typescript
// Use Zod for validation
const schema = z.object({
  email: z.string().email(),
  phone: z.string().regex(/^\+[1-9]\d{1,14}$/),
  name: z.string().min(1).max(100),
});

// Validate before processing
const validated = schema.parse(formData);
```

### Authentication & Authorization

1. Always check permissions in server actions
2. Use Row Level Security (RLS) in Supabase
3. Never expose service role keys
4. Validate sessions on every request

### Data Protection

1. Never log sensitive data (passwords, tokens)
2. Use environment variables for secrets
3. Implement proper CORS policies
4. Follow OWASP guidelines
5. Sanitize all user inputs

### Common Security Pitfalls to Avoid

- Don't trust client-side validation alone
- Don't expose internal IDs in URLs when possible
- Don't store sensitive data in localStorage
- Don't bypass permission checks
- Don't ignore security warnings from dependencies

## Performance Standards

### Page Load Times

- First Contentful Paint: < 1.5s
- Time to Interactive: < 3.5s
- Cumulative Layout Shift: < 0.1
- Lighthouse Score: > 90

### Best Practices

1. **Images**:
   - Use Next.js Image component
   - Optimize image sizes
   - Use appropriate formats (WebP when possible)

2. **Database Queries**:
   - Use indexes appropriately
   - Limit data with `.select()`
   - Implement pagination
   - Avoid N+1 queries

3. **Component Optimization**:
   - Use React.memo for expensive components
   - Implement virtual scrolling for long lists
   - Lazy load non-critical components
   - Minimize bundle size

4. **Caching**:
   - Use `revalidatePath` appropriately
   - Implement proper cache headers
   - Cache expensive computations

### Performance Testing

```bash
# Run Lighthouse
npm run lighthouse

# Analyze bundle size
npm run analyze

# Check for performance issues
npm run perf:check
```

## Getting Help

### Resources

- **Documentation**: Check `/docs` directory
- **Code Examples**: Review existing implementations
- **Team**: Ask in team chat/discussions
- **Issues**: Search/create GitHub issues

### Common Issues

1. **Supabase Connection**: Check environment variables
2. **TypeScript Errors**: Run `npm run type-check`
3. **Build Failures**: Clear `.next` folder and rebuild
4. **SMS Not Sending**: Verify Twilio credentials

### Contact

For questions not covered here:
1. Check existing documentation
2. Search closed issues/PRs
3. Ask in team discussions
4. Create a new issue with details

---

Thank you for contributing to Anchor Management Tools! Your efforts help make our application better for everyone.