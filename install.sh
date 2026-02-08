#!/bin/bash

# Harbor Search Sidebar - Installation Script
# This script automates the setup process

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Functions
print_header() {
    echo ""
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}  ⚓ Harbor Search Sidebar - Installation${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
}

print_step() {
    echo -e "${BLUE}▶${NC} $1"
}

print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

check_prerequisites() {
    print_step "Checking prerequisites..."
    
    # Check Node.js
    if ! command -v node &> /dev/null; then
        print_error "Node.js is not installed"
        echo "  Please install Node.js 18+ from: https://nodejs.org/"
        exit 1
    fi
    
    NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_VERSION" -lt 18 ]; then
        print_error "Node.js version 18+ required (found: $(node -v))"
        exit 1
    fi
    print_success "Node.js $(node -v) found"
    
    # Check npm
    if ! command -v npm &> /dev/null; then
        print_error "npm is not installed"
        exit 1
    fi
    print_success "npm $(npm -v) found"
    
    # Check Firefox (optional)
    if command -v firefox &> /dev/null; then
        print_success "Firefox found"
    else
        print_warning "Firefox not found in PATH (you can still build the extension)"
    fi
}

install_dependencies() {
    print_step "Installing dependencies..."
    npm install
    print_success "Dependencies installed"
}

build_extension() {
    print_step "Building extension for Firefox..."
    npm run build:firefox
    print_success "Extension built successfully"
}

create_icons() {
    print_step "Setting up icons..."
    
    ICONS_DIR="build/icons"
    mkdir -p "$ICONS_DIR"
    
    if [ ! -f "$ICONS_DIR/icon-48.png" ] || [ ! -f "$ICONS_DIR/icon-96.png" ]; then
        print_warning "Icon files not found"
        echo "  Please add icon-48.png and icon-96.png to build/icons/"
        echo "  You can:"
        echo "    1. Use a favicon generator: https://www.favicon-generator.org/"
        echo "    2. Create your own 48x48 and 96x96 PNG images"
        echo "    3. Continue without icons (extension will work but look incomplete)"
        echo ""
        read -p "  Continue without icons? (y/n) " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 1
        fi
    else
        print_success "Icons found"
    fi
}

print_instructions() {
    echo ""
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${GREEN}  Installation Complete! 🎉${NC}"
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    echo -e "${BLUE}Next Steps:${NC}"
    echo ""
    echo "1. Open Firefox"
    echo "2. Navigate to: about:debugging#/runtime/this-firefox"
    echo "3. Click 'Load Temporary Add-on...'"
    echo "4. Select: $(pwd)/build/manifest.json"
    echo ""
    echo -e "${BLUE}Usage:${NC}"
    echo ""
    echo "• Open sidebar: Ctrl+Shift+H (Windows/Linux) or Cmd+Shift+H (macOS)"
    echo "• Right-click menu: Right-click anywhere → 'Search with Harbor'"
    echo "• Toolbar button: Click the Harbor icon"
    echo ""
    echo -e "${BLUE}Documentation:${NC}"
    echo ""
    echo "• Quick Start: cat QUICKSTART.md"
    echo "• Full Guide: cat README.md"
    echo "• Harbor Integration: cat HARBOR_INTEGRATION.md"
    echo ""
    echo -e "${BLUE}Development:${NC}"
    echo ""
    echo "• Start dev server: npm start"
    echo "• Rebuild extension: npm run build:firefox"
    echo "• View structure: cat PROJECT_STRUCTURE.md"
    echo ""
}

# Main execution
main() {
    print_header
    
    check_prerequisites
    echo ""
    
    install_dependencies
    echo ""
    
    build_extension
    echo ""
    
    create_icons
    
    print_instructions
}

# Run main function
main
