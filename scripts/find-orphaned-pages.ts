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
function searchForLinks(route: string): { count: number; files: string[] } {
  const searchPatterns = [
    // Exact route matches
    `href="${route}"`,
    `href='${route}'`,
    `href={\`${route}\`}`,
    `href={"${route}"}`,
    `href={'${route}'}`,
    
    // Router push patterns
    `push('${route}')`,
    `push("${route}")`,
    `push(\`${route}\`)`,
    
    // Router replace patterns
    `replace('${route}')`,
    `replace("${route}")`,
    `replace(\`${route}\`)`,
    
    // Link component patterns
    `<Link.*href="${route}"`,
    `<Link.*href='${route}'`,
    `<Link.*href={\`${route}\`}`,
    
    // Navigation patterns
    `navigate('${route}')`,
    `navigate("${route}")`,
    
    // Redirect patterns
    `redirect('${route}')`,
    `redirect("${route}")`,
  ];
  
  const foundFiles = new Set<string>();
  let totalCount = 0;
  
  // Handle dynamic routes by also searching for concrete examples
  const dynamicPattern = /:([^/]+)/g;
  const isDynamic = dynamicPattern.test(route);
  
  if (isDynamic) {
    // For dynamic routes, search for the pattern without the dynamic segment
    const baseRoute = route.replace(/:([^/]+)/g, '');
    searchPatterns.push(
      `href="${baseRoute}`,
      `href='${baseRoute}`,
      `href={\`${baseRoute}`,
      `push('${baseRoute}`,
      `push("${baseRoute}`,
      `replace('${baseRoute}`,
      `replace("${baseRoute}`,
      `navigate('${baseRoute}`,
      `navigate("${baseRoute}`,
      `redirect('${baseRoute}`,
      `redirect("${baseRoute}`
    );
  }
  
  for (const pattern of searchPatterns) {
    try {
      // Use ripgrep for fast searching
      const result = execSync(
        `rg -l "${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}" src/ --type tsx --type ts --type jsx --type js 2>/dev/null || true`,
        { encoding: 'utf-8', cwd: '/Users/peterpitcher/Cursor/anchor-management-tools' }
      );
      
      if (result.trim()) {
        const files = result.trim().split('\n').filter(Boolean);
        files.forEach(file => foundFiles.add(file));
        totalCount += files.length;
      }
    } catch (error) {
      // Ignore errors from grep not finding matches
    }
  }
  
  // Special handling for root route
  if (route === '/') {
    try {
      // Also search for root redirects and navigations
      const rootPatterns = [
        'href="/"',
        "href='/'",
        'href={`/`}',
        'href={"/"}',
        "href={'/'}",
        'push("/")',
        "push('/')",
        'replace("/")',
        "replace('/')",
        'navigate("/")',
        "navigate('/')",
        'redirect("/")',
        "redirect('/')"
      ];
      
      for (const pattern of rootPatterns) {
        const result = execSync(
          `rg -l "${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}" src/ --type tsx --type ts --type jsx --type js 2>/dev/null || true`,
          { encoding: 'utf-8', cwd: '/Users/peterpitcher/Cursor/anchor-management-tools' }
        );
        
        if (result.trim()) {
          const files = result.trim().split('\n').filter(Boolean);
          files.forEach(file => foundFiles.add(file));
        }
      }
    } catch (error) {
      // Ignore
    }
  }
  
  return { count: foundFiles.size, files: Array.from(foundFiles) };
}

// Main analysis
async function analyzePages() {
  const pages: PageInfo[] = [];
  
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
  
  console.log(`Analyzing ${pageFiles.length} page.tsx files...\n`);
  
  for (const filePath of pageFiles) {
    const routePath = filePathToRoute(filePath);
    console.log(`Checking route: ${routePath}`);
    
    const { count, files } = searchForLinks(routePath);
    
    pages.push({
      filePath,
      routePath,
      hasLinks: count > 0,
      linkCount: count,
      linkedFrom: files
    });
  }
  
  // Report results
  console.log('\n=== ORPHANED PAGES REPORT ===\n');
  
  const orphanedPages = pages.filter(p => !p.hasLinks);
  const linkedPages = pages.filter(p => p.hasLinks);
  
  console.log(`Total pages analyzed: ${pages.length}`);
  console.log(`Orphaned pages (no incoming links): ${orphanedPages.length}`);
  console.log(`Linked pages: ${linkedPages.length}\n`);
  
  if (orphanedPages.length > 0) {
    console.log('ORPHANED PAGES:');
    console.log('===============');
    orphanedPages.forEach(page => {
      console.log(`\nRoute: ${page.routePath}`);
      console.log(`File: ${page.filePath}`);
    });
  }
  
  console.log('\n\nLINKED PAGES SUMMARY:');
  console.log('====================');
  linkedPages
    .sort((a, b) => b.linkCount - a.linkCount)
    .forEach(page => {
      console.log(`\nRoute: ${page.routePath}`);
      console.log(`Links: ${page.linkCount} file(s)`);
      if (page.linkedFrom.length <= 5) {
        console.log('Linked from:');
        page.linkedFrom.forEach(file => console.log(`  - ${file}`));
      }
    });
}

// Run the analysis
analyzePages().catch(console.error);