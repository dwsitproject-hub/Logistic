# Contributing to KLIP

Thank you for your interest in contributing to the KPN Logistics Intelligence Platform!

## Getting Started

1. **Fork the repository**
2. **Clone your fork**:
   ```bash
   git clone https://github.com/your-username/klip.git
   cd klip
   ```
3. **Install dependencies**:
   ```bash
   npm run install:all
   ```
4. **Set up environment** following INSTALLATION.md

## Development Workflow

### 1. Create a Branch

```bash
git checkout -b feature/your-feature-name
# or
git checkout -b fix/bug-description
```

Branch naming conventions:
- `feature/` - New features
- `fix/` - Bug fixes
- `docs/` - Documentation updates
- `refactor/` - Code refactoring
- `test/` - Adding tests

### 2. Make Your Changes

Follow the coding standards in `.cursorrules`

### 3. Test Your Changes

- Test all affected functionality
- Verify API endpoints work correctly
- Check UI on different screen sizes
- Ensure no TypeScript errors

### 4. Commit Your Changes

Use meaningful commit messages:

```bash
git add .
git commit -m "feat: add shipment status filter"
# or
git commit -m "fix: resolve login redirect issue"
```

Commit message format:
- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation update
- `style:` - Code formatting
- `refactor:` - Code refactoring
- `test:` - Adding tests
- `chore:` - Maintenance tasks

### 5. Push to Your Fork

```bash
git push origin feature/your-feature-name
```

### 6. Create a Pull Request

1. Go to the original repository on GitHub
2. Click "New Pull Request"
3. Select your branch
4. Fill in the PR template
5. Submit for review

## Code Standards

### TypeScript

- Use TypeScript for all new files
- Avoid `any` type
- Define proper interfaces
- Enable strict mode

### Frontend (Next.js)

- Use functional components with hooks
- Use 'use client' for client components
- Keep components small (< 300 lines)
- Extract reusable logic to custom hooks
- Use Tailwind CSS for styling

### Backend (Express)

- Use async/await instead of callbacks
- Always handle errors with try/catch
- Use logger instead of console.log
- Return consistent response format
- Document API endpoints with Swagger comments

### Database

- Use parameterized queries (never string concatenation)
- Add appropriate indexes
- Include timestamps
- Use transactions for multi-step operations

## Testing Guidelines

### Manual Testing

1. Test happy path
2. Test error scenarios
3. Test with different user roles
4. Test edge cases

### Future: Automated Testing

We plan to add:
- Unit tests (Jest)
- Integration tests (Supertest)
- E2E tests (Playwright)

## Documentation

When adding features:

1. Update relevant .md files
2. Add JSDoc comments to functions
3. Update API.md if adding endpoints
4. Update FEATURES.md for new features

## Code Review Process

All contributions go through code review:

1. **Automated Checks**: TypeScript compilation, linting
2. **Manual Review**: Code quality, best practices
3. **Testing**: Functionality verification
4. **Documentation**: Ensure docs are updated

## What We Look For

✅ Clean, readable code
✅ Proper error handling
✅ Security best practices
✅ Performance considerations
✅ Documentation updates
✅ Consistent with existing code style

## Pull Request Template

```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing
- [ ] Tested locally
- [ ] Tested different user roles
- [ ] No TypeScript errors
- [ ] API endpoints work correctly

## Checklist
- [ ] Code follows project standards
- [ ] Documentation updated
- [ ] No sensitive data in commits
- [ ] Meaningful commit messages
```

## Areas We Need Help

### High Priority
- [ ] Complete shipment tracking implementation
- [ ] Advanced analytics and charts
- [ ] Bulk import/export features
- [ ] SAP OData integration

### Medium Priority
- [ ] Unit and integration tests
- [ ] Mobile responsive improvements
- [ ] Advanced search filters
- [ ] Email notification system

### Low Priority
- [ ] Dark mode theme
- [ ] Multi-language support
- [ ] Custom report builder
- [ ] Data visualization enhancements

## Bug Reports

When reporting bugs:

1. **Check existing issues** first
2. **Provide details**:
   - Steps to reproduce
   - Expected behavior
   - Actual behavior
   - Screenshots if applicable
   - Environment (OS, browser, versions)

## Feature Requests

When suggesting features:

1. **Describe the use case**
2. **Explain the benefit**
3. **Provide examples** if possible
4. **Consider existing alternatives**

## Code of Conduct

- Be respectful and professional
- Welcome newcomers
- Focus on what is best for the project
- Show empathy towards others

## Questions?

Feel free to:
- Open an issue for questions
- Ask in pull request comments
- Contact the maintainers

## License

By contributing, you agree that your contributions will be licensed under the same license as the project (MIT License).

## Recognition

Contributors will be:
- Listed in the project README
- Mentioned in release notes
- Credited for their work

Thank you for contributing to KLIP! 🙏

