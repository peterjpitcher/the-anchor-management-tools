#!/usr/bin/env tsx
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var fs_1 = require("fs");
var path_1 = require("path");
var secretPatterns = [
    // API Keys and tokens
    { pattern: /api[_-]?key\s*[:=]\s*["']([^"']+)["']/gi, name: 'API Key' },
    { pattern: /token\s*[:=]\s*["']([^"']+)["']/gi, name: 'Token' },
    { pattern: /secret\s*[:=]\s*["']([^"']+)["']/gi, name: 'Secret' },
    { pattern: /password\s*[:=]\s*["']([^"']+)["']/gi, name: 'Password' },
    // Supabase specific
    { pattern: /supabase[_-]?key\s*[:=]\s*["']([^"']+)["']/gi, name: 'Supabase Key' },
    { pattern: /service[_-]?role[_-]?key\s*[:=]\s*["']([^"']+)["']/gi, name: 'Service Role Key' },
    // Database URLs
    { pattern: /postgres:\/\/[^@]+@[^/]+/gi, name: 'Database URL' },
    { pattern: /mysql:\/\/[^@]+@[^/]+/gi, name: 'Database URL' },
    // AWS
    { pattern: /AKIA[0-9A-Z]{16}/g, name: 'AWS Access Key' },
    // Private keys
    { pattern: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/g, name: 'Private Key' },
];
var sqlInjectionPatterns = [
    { pattern: /\$\{[^}]+\}/g, name: 'String interpolation in SQL' },
    { pattern: /\+\s*['"].*SELECT.*FROM/gi, name: 'Concatenated SQL query' },
    { pattern: /query\([^)]*\+[^)]*\)/g, name: 'Dynamic SQL query' },
];
var xssPatterns = [
    { pattern: /dangerouslySetInnerHTML/g, name: 'Dangerous HTML injection' },
    { pattern: /innerHTML\s*=/g, name: 'Direct innerHTML assignment' },
    { pattern: /document\.write/g, name: 'document.write usage' },
];
function scanFile(filePath) {
    var issues = [];
    try {
        var content = (0, fs_1.readFileSync)(filePath, 'utf-8');
        var lines = content.split('\n');
        // Skip if it's a test file or mock
        if (filePath.includes('test') || filePath.includes('mock') || filePath.includes('.env.example')) {
            return issues;
        }
        lines.forEach(function (line, index) {
            // Check for hardcoded secrets
            for (var _i = 0, secretPatterns_1 = secretPatterns; _i < secretPatterns_1.length; _i++) {
                var _a = secretPatterns_1[_i], pattern = _a.pattern, name_1 = _a.name;
                var matches = line.matchAll(pattern);
                for (var _b = 0, matches_1 = matches; _b < matches_1.length; _b++) {
                    var match = matches_1[_b];
                    // Skip if it's using environment variables
                    if (!line.includes('process.env') && !line.includes('import.meta.env')) {
                        issues.push({
                            file: filePath,
                            line: index + 1,
                            issue: "Potential hardcoded ".concat(name_1),
                            severity: 'critical',
                            content: line.trim()
                        });
                    }
                }
            }
            // Check for SQL injection vulnerabilities
            for (var _c = 0, sqlInjectionPatterns_1 = sqlInjectionPatterns; _c < sqlInjectionPatterns_1.length; _c++) {
                var _d = sqlInjectionPatterns_1[_c], pattern = _d.pattern, name_2 = _d.name;
                if (pattern.test(line) && (line.includes('query') || line.includes('sql'))) {
                    issues.push({
                        file: filePath,
                        line: index + 1,
                        issue: "Potential SQL injection: ".concat(name_2),
                        severity: 'high',
                        content: line.trim()
                    });
                }
            }
            // Check for XSS vulnerabilities
            for (var _e = 0, xssPatterns_1 = xssPatterns; _e < xssPatterns_1.length; _e++) {
                var _f = xssPatterns_1[_e], pattern = _f.pattern, name_3 = _f.name;
                if (pattern.test(line)) {
                    issues.push({
                        file: filePath,
                        line: index + 1,
                        issue: "Potential XSS vulnerability: ".concat(name_3),
                        severity: 'high',
                        content: line.trim()
                    });
                }
            }
            // Check for console.log with sensitive data
            if (line.includes('console.log') && (line.includes('password') || line.includes('token') || line.includes('key'))) {
                issues.push({
                    file: filePath,
                    line: index + 1,
                    issue: 'Logging potentially sensitive data',
                    severity: 'medium',
                    content: line.trim()
                });
            }
        });
    }
    catch (error) {
        // Ignore read errors
    }
    return issues;
}
function scanDirectory(dirPath, extensions) {
    var issues = [];
    try {
        var items = (0, fs_1.readdirSync)(dirPath);
        for (var _i = 0, items_1 = items; _i < items_1.length; _i++) {
            var item = items_1[_i];
            var fullPath = (0, path_1.join)(dirPath, item);
            var stat = (0, fs_1.statSync)(fullPath);
            // Skip node_modules, .next, .git
            if (item === 'node_modules' || item === '.next' || item === '.git') {
                continue;
            }
            if (stat.isDirectory()) {
                issues.push.apply(issues, scanDirectory(fullPath, extensions));
            }
            else if (stat.isFile()) {
                var ext = item.split('.').pop();
                if (ext && extensions.includes(ext)) {
                    issues.push.apply(issues, scanFile(fullPath));
                }
            }
        }
    }
    catch (error) {
        // Ignore directory read errors
    }
    return issues;
}
// Main execution
console.log('🔍 PHASE 1: STATIC ANALYSIS - Security Scan\n');
var projectRoot = process.cwd();
var issues = scanDirectory(projectRoot, ['ts', 'tsx', 'js', 'jsx']);
// Group issues by severity
var critical = issues.filter(function (i) { return i.severity === 'critical'; });
var high = issues.filter(function (i) { return i.severity === 'high'; });
var medium = issues.filter(function (i) { return i.severity === 'medium'; });
var low = issues.filter(function (i) { return i.severity === 'low'; });
console.log('📊 Security Scan Summary:');
console.log("Total issues found: ".concat(issues.length));
console.log("  \uD83D\uDD34 Critical: ".concat(critical.length));
console.log("  \uD83D\uDFE0 High: ".concat(high.length));
console.log("  \uD83D\uDFE1 Medium: ".concat(medium.length));
console.log("  \uD83D\uDFE2 Low: ".concat(low.length));
if (critical.length > 0) {
    console.log('\n🔴 CRITICAL Issues:');
    critical.forEach(function (issue) {
        console.log("\n  File: ".concat(issue.file, ":").concat(issue.line));
        console.log("  Issue: ".concat(issue.issue));
        console.log("  Code: ".concat(issue.content.substring(0, 80), "..."));
    });
}
if (high.length > 0) {
    console.log('\n🟠 HIGH Priority Issues:');
    high.forEach(function (issue) {
        console.log("\n  File: ".concat(issue.file, ":").concat(issue.line));
        console.log("  Issue: ".concat(issue.issue));
        console.log("  Code: ".concat(issue.content.substring(0, 80), "..."));
    });
}
if (medium.length > 0) {
    console.log('\n🟡 MEDIUM Priority Issues:');
    medium.slice(0, 5).forEach(function (issue) {
        console.log("\n  File: ".concat(issue.file, ":").concat(issue.line));
        console.log("  Issue: ".concat(issue.issue));
    });
    if (medium.length > 5) {
        console.log("\n  ... and ".concat(medium.length - 5, " more medium priority issues"));
    }
}
console.log('\n✅ Security scan complete!');
