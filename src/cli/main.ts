#!/usr/bin/env node
import { configureProgram } from "./claude-pty-wrapper.js";

configureProgram().parseAsync(process.argv);
