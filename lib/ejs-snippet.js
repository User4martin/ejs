'use strict';
var ejs = require('./ejs');
var utils = require('./utils');

var EjsTemplate = ejs.Template;

function SnippetTemplate(text, opts) {
  EjsTemplate.call(this, text, opts);
}

SnippetTemplate.prototype = Object.create(EjsTemplate.prototype);
SnippetTemplate.modes = EjsTemplate.modes; // TODO ?

SnippetTemplate.prototype.init = function() {
  this.__snippetsKnown = {};
  return EjsTemplate.prototype.init.apply(this, arguments);
};

SnippetTemplate.prototype.scanLine = function(line) {
  var name;
  if(this.mode == EjsTemplate.modes.EVAL && (name = line.match(/^\*\s*snippet\s+(\S+)\s*$/))) {
    // found a new "<%* snippet" section
    this.__snippetParsingDefine = 1;
    name = name [1];
    this.__snippetParsingName = name;
    this.__snippetParsingSource = '';
    return;
  }
  if (! this.__snippetParsingDefine) {
    // not in snippet parsing mode
    return EjsTemplate.prototype.scanLine.call(this, line);
  }

  if (this.__snippetParsingDefine == 1) {
    // expect closing "%>" for snippet section start
    if (line != this.opts.delimiter + '>') {
      throw new Error('Invalid snippet');
    }
    this.__snippetParsingDefine = 2;
    return;
  }
  
  if(this.mode == EjsTemplate.modes.EVAL && line.match(/^\*\s*\/snippet\s*$/)) {
    // found closing "<% /snippet"
    this.__snippetParsingDefine = undefined;
    
    // source contains the "<%" of the section closing tag
    var func = ejs.compile(this.__snippetParsingSource.replace(/<.$/, ''), this.opts);
    this.__snippetsKnown[this.__snippetParsingName] = func;
    return;
  }
  
  // add to snippet source
  this.__snippetParsingSource += line;
};

/* __snippetReplace
  will be called from inside the template "<%- snippet('foo') %>", to insert code from a snippet
  - this and snippet are bound
  - name and data are supplied by the code in the template
*/
SnippetTemplate.prototype.__snippetReplace = function (snippets, name, data) {
  var opts = this.opts;
  var sn = snippets[name];
  if (! sn) {
    throw new Error('unknown snippet: '+name);
  }
  var d = utils.shallowCopy({}, sn.data);
  if (data) {
    data = utils.shallowCopy(d, data);
  } else {
    data = d;
  }
  return sn.code.call(opts.context, data, sn.callerFnArgs);
};

/* __snippetPrepare
  create snippets, associated with data from current call to template
*/
SnippetTemplate.prototype.__snippetPrepare = function (snippets, data, callerFnArgs) {
  var r = {};
  Object.keys(snippets).map(function(k) {
    var s = snippets[k];
    r[k] = { code: s, data: data, callerFnArgs: callerFnArgs };
  });
  return r;
};

SnippetTemplate.prototype.compile = function () {
  var opts = this.opts;
  var fn = EjsTemplate.prototype.compile.apply(this, arguments);
  if (opts.client) {
    return fn;
  }
  
  var self = this;
  var newFn = function (data, callerFnArgs) {
    if (callerFnArgs && callerFnArgs.snippet) {
      var d = utils.shallowCopy({}, data);
      var snippedData = self.__snippetPrepare(self.__snippetsKnown, d, callerFnArgs);
      // add snippets to existing data
      utils.shallowCopy(callerFnArgs.snippet.snippedData, snippedData);
    }
    return fn.apply(self, arguments);
  };
  newFn.dependencies = fn.dependencies;
  return newFn;
};

SnippetTemplate.prototype.generateArgumentNames = function () {
  // if (opts.client) return ...
  return EjsTemplate.prototype.generateArgumentNames.apply(this, arguments).concat(['snippet']);
};

SnippetTemplate.prototype.generateArguments = function (data, opts, ejsArgs, callerFnArgs) {
  // if (opts.client) return ...
  var r = EjsTemplate.prototype.generateArguments.apply(this, arguments);

  var snippetFn = callerFnArgs.snippet;
  if (! snippetFn) {
    // top level template, create "snippet" function
    var d = utils.shallowCopy({}, data);
    var snippedData = this.__snippetPrepare(this.__snippetsKnown, d, callerFnArgs);
    snippetFn = this.__snippetReplace.bind(this, snippedData);
    snippetFn.snippedData = snippedData;
  }
  
  r.snippet = snippetFn;
  return r;
};


ejs.Template = SnippetTemplate;
