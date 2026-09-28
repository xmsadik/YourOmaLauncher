.pragma library

// Environment expansion for single-value fields (targets, working directories): a leading "~" or
// "~/", "$VAR" and "${VAR}". Unknown variables are left as written, so a typo stays visible instead of
// silently becoming an empty string. "\$" is a literal "$". No word splitting, no globbing.
//
// env is either a function(name) → value (in QML: Quickshell.env) or a plain { NAME: value } object
// (tests). Missing, null and undefined all mean "not set".

function lookup(env, name) {
  var value = null
  if (typeof env === "function") value = env(name)
  else if (env && Object.prototype.hasOwnProperty.call(env, name)) value = env[name]
  return value === null || value === undefined ? null : String(value)
}

function expand(input, env) {
  if (input === null || input === undefined) return null
  var s = String(input)
  var home = lookup(env, "HOME")
  if (home !== null && (s === "~" || s.indexOf("~/") === 0)) s = home + s.substring(1)

  var out = ""
  var i = 0
  while (i < s.length) {
    var c = s.charAt(i)
    if (c === "\\" && s.charAt(i + 1) === "$") {
      out += "$"
      i += 2
    } else if (c === "$") {
      var m = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}/.exec(s.substring(i)) || /^\$([A-Za-z_][A-Za-z0-9_]*)/.exec(s.substring(i))
      var value = m ? lookup(env, m[1]) : null
      if (m && value !== null) {
        out += value
        i += m[0].length
      } else if (m) {
        out += m[0]
        i += m[0].length
      } else {
        out += c
        i++
      }
    } else {
      out += c
      i++
    }
  }
  return out
}
