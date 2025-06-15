# Development Guide

This guide covers development practices, coding standards, and workflows for contributing to The Anchor Management Tools.

## Getting Started

### Development Setup

1. **Clone the Repository**
   ```bash
   git clone https://github.com/your-org/EventPlanner3.0.git
   cd EventPlanner3.0
   ```

2. **Install Dependencies**
   ```bash
   npm install
   ```

3. **Set Up Environment**
   ```bash
   cp .env.example .env.local
   # Edit .env.local with your development credentials
   ```

4. **Start Development Server**
   ```bash
   npm run dev
   ```

## Development Standards

### Code Style

#### TypeScript
- Use TypeScript for all new code
- Enable strict mode
- Define types for all functions
- Avoid `any` type
- Use interfaces over types when possible

```typescript
// Good
interface Employee {
  id: string;
  firstName: string;
  lastName: string;
}

function getEmployee(id: string): Promise<Employee> {
  // Implementation
}

// Avoid
function getEmployee(id: any): any {
  // Implementation
}
```

#### React Components
- Use functional components
- Implement proper TypeScript interfaces
- Handle loading and error states
- Make components reusable

```typescript
// Good component structure
interface EmployeeCardProps {
  employee: Employee;
  onEdit?: (id: string) => void;
}

export function EmployeeCard({ employee, onEdit }: EmployeeCardProps) {
  // Component implementation
}
```

#### Styling
- Use Tailwind CSS classes
- Follow mobile-first approach
- Maintain consistent spacing
- Use design system colors

```tsx
// Good
<div className="bg-white p-4 rounded-lg shadow sm:p-6">
  <h2 className="text-lg font-medium text-gray-900">Title</h2>
</div>

// Avoid inline styles
<div style={{ backgroundColor: 'white', padding: '16px' }}>
```

### File Organization

#### Directory Structure
```
src/
├── app/                    # Next.js app directory
│   ├── (authenticated)/    # Protected routes
│   ├── actions/           # Server actions
│   └── api/              # API routes
├── components/           # Reusable components
├── lib/                 # Utilities and helpers
└── types/              # TypeScript definitions
```

#### Naming Conventions
- Components: PascalCase (`EmployeeCard.tsx`)
- Utilities: camelCase (`formatDate.ts`)
- Types: PascalCase (`Database.ts`)
- Constants: UPPER_SNAKE_CASE
- Files: Match export name

### Database Development

#### Migrations
- Create numbered migration files
- Include up and down migrations
- Test before committing
- Document breaking changes

```sql
-- Good migration structure
-- 20240115_add_employee_status.sql

-- Up Migration
ALTER TABLE employees 
ADD COLUMN status TEXT NOT NULL DEFAULT 'Active';

-- Down Migration (in comments)
-- ALTER TABLE employees DROP COLUMN status;
```

#### Queries
- Use Supabase client properly
- Handle errors gracefully
- Use proper TypeScript types
- Optimize for performance

```typescript
// Good query pattern
export async function getEmployeeWithNotes(id: string) {
  const supabase = createClient();
  
  const { data, error } = await supabase
    .from('employees')
    .select(`
      *,
      employee_notes (
        *,
        created_by_user:auth.users!created_by (
          email
        )
      )
    `)
    .eq('employee_id', id)
    .single();

  if (error) throw error;
  return data;
}
```

### Server Actions

#### Best Practices
- Validate all inputs
- Use proper error handling
- Return meaningful responses
- Implement revalidation

```typescript
// Good server action
export async function updateEmployee(
  employeeId: string,
  formData: FormData
) {
  try {
    // Validate inputs
    const firstName = formData.get('first_name')?.toString();
    if (!firstName) {
      throw new Error('First name is required');
    }

    // Update database
    const { error } = await supabase
      .from('employees')
      .update({ first_name: firstName })
      .eq('employee_id', employeeId);

    if (error) throw error;

    // Revalidate cache
    revalidatePath(`/employees/${employeeId}`);
    
    return { success: true };
  } catch (error) {
    return { 
      success: false, 
      error: error.message 
    };
  }
}
```

## Testing

### Manual Testing
- Test all user flows
- Verify mobile responsiveness
- Check error handling
- Test edge cases
- Verify SMS delivery

### Testing Checklist
- [ ] Feature works as expected
- [ ] Mobile layout correct
- [ ] Errors handled gracefully
- [ ] Loading states shown
- [ ] Form validation works
- [ ] Database updates correctly
- [ ] SMS sends properly

### Future: Automated Testing
When implementing tests:
- Unit tests for utilities
- Integration tests for server actions
- Component tests with React Testing Library
- E2E tests for critical paths

## Git Workflow

### Branch Strategy
```bash
main           # Production code
├── develop    # Development branch
└── feature/*  # Feature branches
```

### Commit Messages
Follow conventional commits:
```
feat: add employee document upload
fix: resolve SMS delivery issue
docs: update deployment guide
refactor: improve database queries
test: add employee service tests
```

### Pull Request Process
1. Create feature branch
2. Make changes
3. Run linting
4. Test thoroughly
5. Create PR with description
6. Request review
7. Address feedback
8. Merge when approved

## Common Development Tasks

### Adding a New Feature

1. **Plan the Feature**
   - Define requirements
   - Design database schema
   - Plan UI/UX
   - Consider edge cases

2. **Implementation Steps**
   ```bash
   # Create feature branch
   git checkout -b feature/new-feature
   
   # Create migrations if needed
   touch supabase/migrations/timestamp_description.sql
   
   # Update types
   npm run generate-types
   
   # Implement feature
   # Test thoroughly
   
   # Commit and push
   git add .
   git commit -m "feat: implement new feature"
   git push origin feature/new-feature
   ```

### Debugging

#### Client-Side Debugging
```typescript
// Use console.log strategically
console.log('Employee data:', employee);

// Use React Developer Tools
// Check component props and state

// Use Network tab for API calls
```

#### Server-Side Debugging
```typescript
// In server actions
console.log('Form data:', Object.fromEntries(formData));

// Check Vercel logs
// Review Supabase logs
```

### Performance Optimization

1. **Database Queries**
   - Use select to limit fields
   - Add appropriate indexes
   - Batch operations when possible
   - Use connection pooling

2. **React Performance**
   - Implement React.memo for expensive components
   - Use useMemo and useCallback appropriately
   - Lazy load components
   - Optimize images

3. **Bundle Size**
   - Use dynamic imports
   - Tree shake unused code
   - Analyze bundle size
   - Minimize dependencies

## Environment Management

### Local Development
```env
# .env.local
NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=local-anon-key
# Use local Supabase instance
```

### Staging Environment
- Create separate Supabase project
- Use staging environment variables
- Test migrations before production
- Verify all features

## Security Considerations

### Input Validation
- Validate all user inputs
- Sanitize data before storage
- Use parameterized queries
- Implement rate limiting

### Authentication
- Verify user sessions
- Check permissions
- Log security events
- Handle errors safely

### Data Protection
- Never log sensitive data
- Use environment variables
- Implement proper CORS
- Follow OWASP guidelines

## Resources

### Documentation
- [Next.js Docs](https://nextjs.org/docs)
- [Supabase Docs](https://supabase.com/docs)
- [Tailwind CSS](https://tailwindcss.com/docs)
- [TypeScript Handbook](https://www.typescriptlang.org/docs)

### Tools
- React Developer Tools
- Supabase Studio
- Vercel CLI
- TypeScript Playground

### Learning Resources
- Next.js tutorials
- Supabase guides
- React patterns
- TypeScript tips

## Getting Help

### Internal Resources
- Review existing code
- Check documentation
- Ask team members
- Review PRs

### External Resources
- Stack Overflow
- GitHub Discussions
- Discord communities
- Official forums