/**
 * Import every command module so its defineCommand() calls register — this
 * file's side effects ARE the command surface. Add new command files to this
 * list; nothing else needs to know about them.
 */
import './profile'
import './venues'
import './exercises'
import './sessions'

export * from './registry'
export * from './context'
