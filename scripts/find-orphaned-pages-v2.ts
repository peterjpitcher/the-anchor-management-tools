#!/usr/bin/env tsx
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

interface PageInfo {
  filePath: string;
  routePath: string;
  hasLinks: boolean;
  linkCount: number;
  linkedFrom: string[];
}

// Convert file path to route path
function filePathToRoute(filePath: string): string {
  // Remove src/app prefix and page.tsx suffix
  let route = filePath
    .replace(/^.*\/src\/app/, '')
    .replace(/\/page\.tsx$/, '');
  
  // Remove (authenticated) and other route groups
  route = route.replace(/\/\([^)]+\)/g, '');
  
  // Handle dynamic routes
  route = route.replace(/\[([^\]]+)\]/g, ':$1');
  
  // Root page
  if (route === '') route = '/';
  
  return route;
}

// Search for links to a specific route
function searchForLinks(route: string, pageFiles: string[]): { count: number; files: string[] } {
  const foundFiles = new Set<string>();
  
  // For searching, we need to handle dynamic routes specially
  const isDynamic = route.includes(':');
  let searchRoute = route;
  let baseRoute = route;
  
  if (isDynamic) {
    // For dynamic routes like /events/:id, also search for /events/
    baseRoute = route.substring(0, route.lastIndexOf(':') - 1);
  }
  
  try {
    // Search for exact route matches in href, push, replace, navigate, redirect
    const patterns = [
      `href="${searchRoute}"`,
      `href='${searchRoute}'`,
      `href={\`${searchRoute}\`}`,
      `href={"${searchRoute}"}`,
      `href={'${searchRoute}'}`,
      `push('${searchRoute}')`,
      `push("${searchRoute}")`,
      `push(\`${searchRoute}\`)`,
      `replace('${searchRoute}')`,
      `replace("${searchRoute}")`,
      `navigate('${searchRoute}')`,
      `navigate("${searchRoute}")`,
      `redirect('${searchRoute}')`,
      `redirect("${searchRoute}")`
    ];
    
    // For dynamic routes, also search for the base path
    if (isDynamic && baseRoute) {
      patterns.push(
        `href="${baseRoute}/`,
        `href='${baseRoute}/`,
        `href={\`${baseRoute}/`,
        `push('${baseRoute}/`,
        `push("${baseRoute}/`,
        `navigate('${baseRoute}/`,
        `redirect('${baseRoute}/`
      );
    }
    
    // Special handling for root route
    if (route === '/') {
      patterns.push(
        'href="/"',
        "href='/'",
        'href={`/`}',
        'href={"/"}',
        "href={'/'}",
        'push("/")',
        "push('/')",
        'navigate("/")',
        "navigate('/')",
        'redirect("/")',
        "redirect('/')"
      );
    }
    
    // Use grep to search for each pattern
    for (const pattern of patterns) {
      try {
        const escapedPattern = pattern.replace(/[[\]{}()*+?.\\^$|]/g, '\\$&');
        const cmd = `grep -r "${escapedPattern}" src/ --include="*.tsx" --include="*.ts" -l 2>/dev/null || true`;
        const result = execSync(cmd, { 
          encoding: 'utf-8', 
          cwd: '/Users/peterpitcher/Cursor/anchor-management-tools' 
        });
        
        if (result.trim()) {
          const files = result.trim().split('\n').filter(Boolean);
          files.forEach(file => {
            // Don't count the page linking to itself
            if (!file.includes(pageFiles.find(pf => pf.includes(route)) || '')) {
              foundFiles.add(file);
            }
          });
        }
      } catch (e) {
        // Ignore grep errors
      }
    }
    
    // Additional check for navigation components that might use the route
    if (route !== '/' && !route.includes(':')) {
      // Check for route in navigation arrays or objects
      const navPatterns = [
        `"${route}"`,
        `'${route}'`,
        `\`${route}\``
      ];
      
      for (const pattern of navPatterns) {
        try {
          const cmd = `grep -r "${pattern}" src/components/ src/app/ --include="*.tsx" --include="*.ts" -l 2>/dev/null || true`;
          const result = execSync(cmd, { 
            encoding: 'utf-8', 
            cwd: '/Users/peterpitcher/Cursor/anchor-management-tools' 
          });
          
          if (result.trim()) {
            const files = result.trim().split('\n').filter(Boolean);
            // Check if these files actually contain navigation-related code
            files.forEach(file => {
              const content = fs.readFileSync(path.join('/Users/peterpitcher/Cursor/anchor-management-tools', file), 'utf-8');
              if (content.includes('href') || content.includes('Link') || content.includes('navigate') || content.includes('push')) {
                foundFiles.add(file);
              }
            });
          }
        } catch (e) {
          // Ignore
        }
      }
    }
    
  } catch (error) {
    console.error('Error searching for route:', route, error);
  }
  
  return { count: foundFiles.size, files: Array.from(foundFiles) };
}

// Main analysis
async function analyzePages() {
  const pageFiles = [
    "/Users/peterpitcher/Cursor/anchor-management-tools/src/app/(authenticated)/employees/new/page.tsx",
    "/Users/peterpitcher/Cursor/anchor-management-tools/src/app/page.tsx",
    "/Users/peterpitcher/Cursor/anchor-management-tools/src/app/(authenticated)/profile/change-password/page.tsx",
    "/Users/peterpitcher/Cursor/anchor-management-tools/src/app/(authenticated)/settings/sms-delivery/page.tsx",
    "/Users/peterpitcher/Cursor/anchor-management-tools/src/app/(authenticated)/roles/page.tsx",
    "/Users/peterpitcher/Cursor/anchor-management-tools/src/app/(authenticated)/roles/new/page.tsx",
    "/Users/peterpitcher/Cursor/anchor-management-tools/src/app/(authenticated)/private-bookings/[id]/contract/page.tsx",
    "/Users/peterpitcher/Cursor/anchor-management-tools/src/app/(authenticated)/employees/[employee_id]/edit/page.tsx",
    "/Users/peterpitcher/Cursor/anchor-management-tools/src/app/(authenticated)/settings/categories/page.tsx",
    "/Users/peterpitcher/Cursor/anchor-management-tools/src/app/(authenticated)/settings/sms-health/page.tsx",
    "/Users/peterpitcher/Cursor/anchor-management-tools/src/app/(authenticated)/unauthorized/page.tsx",
    "/Users/peterpitcher/Cursor/anchor-management-tools/src/app/(authenticated)/private-bookings/[id]/items/page.tsx",
    "/Users/peterpitcher/Cursor/anchor-management-tools/src/app/(authenticated)/private-bookings/[id]/messages/page.tsx",
    "/Users/peterpitcher/Cursor/anchor-management-tools/src/app/(authenticated)/profile/page.tsx",
    "/Users/peterpitcher/Cursor/anchor-management-tools/src/app/(authenticated)/settings/import-messages/page.tsx",
    "/Users/peterpitcher/Cursor/anchor-management-tools/src/app/(authenticated)/settings/message-templates/page.tsx",
    "/Users/peterpitcher/Cursor/anchor-management-tools/src/app/(authenticated)/messages/bulk/page.tsx",
    "/Users/peterpitcher/Cursor/anchor-management-tools/src/app/privacy/page.tsx",
    "/Users/peterpitcher/Cursor/anchor-management-tools/src/app/(authenticated)/private-bookings/new/page.tsx",
    "/Users/peterpitcher/Cursor/anchor-management-tools/src/app/(authenticated)/employees/[employee_id]/page.tsx",
    "/Users/peterpitcher/Cursor/anchor-management-tools/src/app/(authenticated)/settings/webhook-monitor/page.tsx",
    "/Users/peterpitcher/Cursor/anchor-management-tools/src/app/(authenticated)/users/page.tsx",
    "/Users/peterpitcher/Cursor/anchor-management-tools/src/app/auth/login/page.tsx",
    "/Users/peterpitcher/Cursor/anchor-management-tools/src/app/auth/signup/page.tsx",
    "/Users/peterpitcher/Cursor/anchor-management-tools/src/app/(authenticated)/private-bookings/calendar/page.tsx",
    "/Users/peterpitcher/Cursor/anchor-management-tools/src/app/(authenticated)/private-bookings/sms-queue/page.tsx",
    "/Users/peterpitcher/Cursor/anchor-management-tools/src/app/(authenticated)/employees/page.tsx",
    "/Users/peterpitcher/Cursor/anchor-management-tools/src/app/(authenticated)/private-bookings/[id]/edit/page.tsx",
    "/Users/peterpitcher/Cursor/anchor-management-tools/src/app/(authenticated)/private-bookings/[id]/page.tsx",
    "/Users/peterpitcher/Cursor/anchor-management-tools/src/app/(authenticated)/settings/webhook-diagnostics/page.tsx",
    "/Users/peterpitcher/Cursor/anchor-management-tools/src/app/(authenticated)/settings/fix-phone-numbers/page.tsx",
    "/Users/peterpitcher/Cursor/anchor-management-tools/src/app/(authenticated)/customers/page.tsx",
    "/Users/peterpitcher/Cursor/anchor-management-tools/src/app/login/page.tsx",
    "/Users/peterpitcher/Cursor/anchor-management-tools/src/app/(authenticated)/settings/api-keys/page.tsx",
    "/Users/peterpitcher/Cursor/anchor-management-tools/src/app/(authenticated)/settings/business-hours/page.tsx",
    "/Users/peterpitcher/Cursor/anchor-management-tools/src/app/(authenticated)/settings/page.tsx",
    "/Users/peterpitcher/Cursor/anchor-management-tools/src/app/(authenticated)/customers/[id]/page.tsx",
    "/Users/peterpitcher/Cursor/anchor-management-tools/src/app/(authenticated)/settings/calendar-test/page.tsx",
    "/Users/peterpitcher/Cursor/anchor-management-tools/src/app/(authenticated)/settings/gdpr/page.tsx",
    "/Users/peterpitcher/Cursor/anchor-management-tools/src/app/(authenticated)/messages/page.tsx",
    "/Users/peterpitcher/Cursor/anchor-management-tools/src/app/(authenticated)/private-bookings/page.tsx",
    "/Users/peterpitcher/Cursor/anchor-management-tools/src/app/(authenticated)/private-bookings/settings/catering/page.tsx",
    "/Users/peterpitcher/Cursor/anchor-management-tools/src/app/(authenticated)/private-bookings/settings/spaces/page.tsx",
    "/Users/peterpitcher/Cursor/anchor-management-tools/src/app/(authenticated)/private-bookings/settings/vendors/page.tsx",
    "/Users/peterpitcher/Cursor/anchor-management-tools/src/app/(authenticated)/settings/background-jobs/page.tsx",
    "/Users/peterpitcher/Cursor/anchor-management-tools/src/app/(authenticated)/settings/webhook-test/page.tsx",
    "/Users/peterpitcher/Cursor/anchor-management-tools/src/app/(authenticated)/settings/audit-logs/page.tsx",
    "/Users/peterpitcher/Cursor/anchor-management-tools/src/app/(authenticated)/events/page.tsx",
    "/Users/peterpitcher/Cursor/anchor-management-tools/src/app/(authenticated)/dashboard/page.tsx",
    "/Users/peterpitcher/Cursor/anchor-management-tools/src/app/(authenticated)/events/new/page.tsx",
    "/Users/peterpitcher/Cursor/anchor-management-tools/src/app/(authenticated)/events/[id]/edit/page.tsx",
    "/Users/peterpitcher/Cursor/anchor-management-tools/src/app/(authenticated)/events/[id]/page.tsx",
    "/Users/peterpitcher/Cursor/anchor-management-tools/src/app/(authenticated)/settings/event-categories/page.tsx"
  ];
  
  const pages: PageInfo[] = [];
  
  console.log(`Analyzing ${pageFiles.length} page.tsx files...\n`);
  
  for (const filePath of pageFiles) {
    const routePath = filePathToRoute(filePath);
    process.stdout.write(`Checking route: ${routePath}... `);
    
    const { count, files } = searchForLinks(routePath, pageFiles);
    
    pages.push({
      filePath,
      routePath,
      hasLinks: count > 0,
      linkCount: count,
      linkedFrom: files
    });
    
    console.log(count > 0 ? `✓ (${count} links)` : '✗ (orphaned)');
  }
  
  // Report results
  console.log('\n=== ORPHANED PAGES REPORT ===\n');
  
  const orphanedPages = pages.filter(p => !p.hasLinks);
  const linkedPages = pages.filter(p => p.hasLinks);
  
  console.log(`Total pages analyzed: ${pages.length}`);
  console.log(`Orphaned pages (no incoming links): ${orphanedPages.length}`);
  console.log(`Linked pages: ${linkedPages.length}\n`);
  
  if (orphanedPages.length > 0) {
    console.log('ORPHANED PAGES (No incoming links found):');
    console.log('=========================================\n');
    orphanedPages.forEach(page => {
      console.log(`Route: ${page.routePath}`);
      console.log(`File: ${page.filePath.replace('/Users/peterpitcher/Cursor/anchor-management-tools/', '')}`);
      console.log('---');
    });
  }
  
  if (linkedPages.length > 0) {
    console.log('\n\nLINKED PAGES SUMMARY:');
    console.log('====================\n');
    linkedPages
      .sort((a, b) => b.linkCount - a.linkCount)
      .forEach(page => {
        console.log(`Route: ${page.routePath} (${page.linkCount} links)`);
        console.log(`File: ${page.filePath.replace('/Users/peterpitcher/Cursor/anchor-management-tools/', '')}`);
        if (page.linkedFrom.length <= 5) {
          console.log('Linked from:');
          page.linkedFrom.forEach(file => console.log(`  - ${file}`));
        } else {
          console.log(`Linked from ${page.linkCount} files (showing first 5):`);
          page.linkedFrom.slice(0, 5).forEach(file => console.log(`  - ${file}`));
        }
        console.log('---');
      });
  }
}

// Run the analysis
analyzePages().catch(console.error);