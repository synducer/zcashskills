# Contributing to ZCash Skills

Thank you for your interest in contributing to ZCash Skills! This project aims to provide privacy-preserving ZCash capabilities to AI agents with local cryptographic execution.

## Getting Started

### Prerequisites

- Node.js 16+ 
- Rust toolchain (for building native modules)
- Git

### Development Setup

1. **Fork and clone the repository**
   ```bash
   git clone https://github.com/YOUR_USERNAME/zcashskills.git
   cd zcashskills
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Build native modules**
   ```bash
   npm run build
   ```

4. **Run tests**
   ```bash
   npm test
   ```

5. **Test in development**
   ```bash
   node -e "const zcash = require('./lib'); zcash.generateAddress().then(console.log);"
   ```

## Contributing Guidelines

### Code Style

- Use consistent JavaScript/TypeScript formatting
- Follow existing naming conventions
- Add JSDoc comments for public APIs
- Use meaningful variable and function names

### Adding New Skills

1. **Create skill directory**
   ```
   skills/my-new-skill/
   ├── index.js          # Main implementation
   ├── README.md         # Skill documentation
   └── test.js          # Skill-specific tests
   ```

2. **Follow the standard skill API pattern**
   ```javascript
   async function myNewSkill({ param1, param2 } = {}) {
     try {
       // Implementation here
       
       return {
         success: true,
         // ... result data
         execution: 'local',
         timestamp: new Date().toISOString()
       };
     } catch (error) {
       return {
         success: false,
         error: error.message,
         code: 'MY_SKILL_ERROR',
         execution: 'local',
         timestamp: new Date().toISOString()
       };
     }
   }
   
   module.exports = myNewSkill;
   module.exports.meta = {
     name: 'my-new-skill',
     description: 'Description of what this skill does',
     // ... other metadata
   };
   ```

3. **Add to main exports**
   Update `lib/index.js` to include your new skill.

4. **Write comprehensive tests**
   Add unit tests in `test/unit/my-new-skill.test.js`.

### Rust Development

For native module changes:

1. **Follow Rust conventions**
   - Use `snake_case` for functions and variables
   - Add comprehensive error handling
   - Include documentation comments

2. **Update Rust code in `native/src/`**
   - Keep functions focused and single-purpose
   - Validate inputs from JavaScript
   - Return structured error information

3. **Test across platforms**
   - Ensure code works on Linux, macOS, Windows
   - Test both x64 and ARM64 architectures

### Testing

#### Unit Tests
```bash
npm run test:unit
```

#### Integration Tests  
```bash
npm run test:integration
```

#### Platform Testing
Test on multiple platforms:
- Linux x64
- macOS Intel (x64) 
- macOS Apple Silicon (arm64)
- Windows x64

### Documentation

- Update README.md for new features
- Add examples in `examples/` directory
- Include JSDoc comments for all public APIs
- Update skill metadata

## Submission Process

1. **Create a feature branch**
   ```bash
   git checkout -b feature/my-new-feature
   ```

2. **Make your changes**
   - Follow the guidelines above
   - Write/update tests
   - Update documentation

3. **Test thoroughly**
   ```bash
   npm test
   npm run lint
   ```

4. **Commit with clear messages**
   ```bash
   git commit -m "feat: add new skill for X functionality"
   ```
   
   Use conventional commit format:
   - `feat:` for new features
   - `fix:` for bug fixes
   - `docs:` for documentation
   - `test:` for tests
   - `refactor:` for code refactoring

5. **Push and create pull request**
   ```bash
   git push origin feature/my-new-feature
   ```

6. **Pull Request Requirements**
   - Clear description of changes
   - Reference any related issues
   - Include test results
   - Update documentation as needed

## Security Considerations

Since this library handles cryptographic operations:

- Never log private keys or sensitive data
- Validate all inputs thoroughly  
- Use secure random number generation
- Follow cryptographic best practices
- Report security issues privately

## Release Process

1. Version following semantic versioning (semver)
2. Update CHANGELOG.md
3. Build and test native modules for all platforms
4. Publish to NPM
5. Create GitHub release with binaries

## Getting Help

- **Issues**: https://github.com/konradgnat/zcashskills/issues
- **Discussions**: https://github.com/konradgnat/zcashskills/discussions
- **Email**: [maintainer email]

## Code of Conduct

- Be respectful and inclusive
- Focus on constructive feedback
- Help newcomers learn
- Maintain professional communication

## License

By contributing, you agree that your contributions will be licensed under the MIT License.