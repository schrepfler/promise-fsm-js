/*!
 * PromiseFSM 0.1.0
 * Mon, 25 May 2015 15:40:56 GMT
 *
 * https://github.com/sebastiancarlsson/promise-fsm-js/
 *
 * (c) 2015 Sebastian Carlsson
 *
 * MIT license
 * https://github.com/sebastiancarlsson/promise-fsm-js/blob/master/LICENSE
 *
 **/
var PromiseFSMModule = angular.module("PromiseFSMModule", []);
PromiseFSMModule.service("PromiseFSM", ["$q", function ($q) {

var PromiseFSM = (function() {
	"use strict";

	function StateMachine(name, options) {
		this.name = name;
		this.states = [];
		this.transitions = [];
		this.listeners = [];

		this.locked = false;
		//this.transitioning = false;

		if (options.actions) this.actions = options.actions;
		if (options.states) this.states = options.states;
		this.verbose = options.verbose || false;

		this.interface = {
			$getState: this.getState.bind(this),
			$addTransition: this.addTransition.bind(this),
			$removeTransition: this.removeTransition.bind(this),
			$addEventListener: this.addEventlistener.bind(this),
			$removeEventListener: this.removeEventListener.bind(this)
		};

		if(this.verbose === true) {
			log("Initializing state machine \"" + this.name + "\"");
		}

		if(!promiseAdapter) {
			throw new Error("PromiseFSM - No promise adapter. Promise adapter must be set through PromiseFSM.setPromiseAdapter() before initialization");
		}

		if(options.states && Object.prototype.toString.call(this.states) === '[object Array]' && options.states.length > 1) {
			this.states = options.states;
		} else {
			throw new Error("PromiseFSM - You have to define at least two states. E.g. options.states = [\"state1\", \"state2\"]");
		}

		if(options.actions && Object.prototype.toString.call(this.actions) === '[object Object]' && Object.keys(options.actions).length > 0) {
			this.actions = options.actions;
			for(var key in this.actions) {
				this.interface[key] = this.transition.bind(this, this.actions[key].from, this.actions[key].to);
			}
		} else {
			throw new Error("PromiseFSM - You have to define at least one action. E.g. options.actions = { myAction: { from: \"state1\", to: \"state2\" } }");
		}
		
		if(options.initialState) {
			this.initialState = this.state = options.initialState;
		} else {
			this.initialState = this.state = this.states[0];
		}
	}

	StateMachine.prototype.getState = function() {
		return this.state;
	};

	StateMachine.prototype.transition = function(from, to) {
		var deferred = promiseAdapter.defer();
		if(this.locked) {
			if(this.verbose) {
				warn("State change failed - machine is locked");
			}

			deferred.reject(new Error(errorNames.LOCKED));
			return deferred.promise;
		}
		
		if(!this.isSwitchLegal(from, to)) {
			if(this.verbose) {
				warn("State change failed - illegal transition attempt from \"" + this.state + "\" to \"" + newState + "\"");
			}
			
			deferred.reject(new Error(errorNames.ILLEGAL_TRANSITION));
			return deferred.promise;
		}
		
		this.locked = true;
		this.dispatchEvent(new StateMachineEvent(eventNames.LOCKED, from, to));

		// TODO add guards here
		this.dispatchEvent(new StateMachineEvent(eventNames.EXIT_STATE, from, to));
		//this.transitioning = true;

		if(this.verbose) {
			log("\"" + from + "\" -> \"" + to + "\"");
		}

		var callbacks = [];
		var i = this.transitions.length;
		while(i--) {
			if(this.transitions[i].from === from && this.transitions[i].to === to) {
				callbacks.push(this.transitions[i].callback);
			}
		}

		if(callbacks.length > 0) {
			if(this.verbose) {
				log("Pending state change from \"" + from + "\" -> \"" + to + "\"...");
			}

			var subPromises = [];
			var subDeferred;
			i = callbacks.length;
			while(i--) {
				subDeferred = promiseAdapter.defer();
				subPromises.push(subDeferred.promise);
				callbacks[i](subDeferred.resolve);
			}

			var promise = promiseAdapter.all(subPromises);
			promise.then(this.completeSwitch.bind(this, to));
			return promise;
		} else {
			this.completeSwitch(to);
			deferred.resolve();
			return deferred.promise;
		}
	};
	
	StateMachine.prototype.completeSwitch = function(to) {
		var from = this.state;
		this.state = to;
		this.dispatchEvent(new StateMachineEvent(eventNames.ENTER_STATE, from, to));

		this.locked = false;
		this.dispatchEvent(new StateMachineEvent(eventNames.UNLOCKED, from, to));

		//this.transitioning = false;
		this.dispatchEvent(new StateMachineEvent(eventNames.STATE_CHANGED, from, to));

		if(this.verbose) {
			log("Transition completed. New state is \"" + to + "\".");
		}
	};

	StateMachine.prototype.isSwitchLegal = function(from, to) {
		if(from !== this.state) {
			return false;
		}

		if (from === to) {
			return false;
		}

		if (this.states.indexOf(to) === -1) {
			console.log('doesnt exist');
			return false;
		}

		for(var i in this.actions) {
			if (this.actions[i].to === to) {
				if (typeof this.actions[i].from === 'string' && (this.actions[i].from === from || this.actions[i].from === '*')) {
					return true;
				} else if (Object.prototype.toString.call(this.actions[i].from) === '[object Array]') {
					var toArray = this.actions[i].from;
					var j = toArray.length;
					while (j--) {
						if (toArray[j] === from) {
							return true;
						}
					}
				}
			}
		}

		return false;
	};

	StateMachine.prototype.addTransition = function(from, to, callback) {
		if(this.getTransitionIndex(from, to, callback) > -1) {
			warn("Duplicate transition added, only the first will be called");
		} else {
			this.transitions.push({
				from: from,
				to: to,
				callback: callback
			});
		}
	};

	StateMachine.prototype.removeTransition = function(from, to, callback) {
		var i = this.getTransitionIndex(from, to, callback);
		if(i > -1) {
			this.transitions.splice(i, 1);
		}
	};

	StateMachine.prototype.getTransitionIndex = function(from, to, callback) {
		var i = this.transitions.length;
		while(i--) {
			if(this.transitions[i].from === from && this.transitions[i].to === to && this.transitions[i].callback === callback) {
				return i;
			}
		}
		return -1;
	};

	StateMachine.prototype.addEventlistener = function(type, callback) {
		this.listeners.push({
			type: type,
			callback: callback
		});
	};

	StateMachine.prototype.removeEventListener = function(type, callback) {
		var i = this.listeners.length;
		while(i--) {
			if(this.listeners[i].type === type && this.listeners[i].callback === callback) {
				this.listeners.splice(i, 1);
			}
		}
	};

	StateMachine.prototype.dispatchEvent = function(evt) {
		var i = this.listeners.length;
		while(i--) {
			if(this.listeners[i].type === evt.type) {
				this.listeners[i].callback(evt);
			}
		}
	};

	StateMachine.prototype.getInterface = function() {
		return this.interface;
	};

	function log(text) {
		if(console) {
			console.log("%cPromiseFSM", "color: #00f", text);
		}
	}

	function warn(text) {
		if(console) {
			console.warn("%cPromiseFSM", "color: #00f", text);
		}
	}

	var eventNames = {
		LOCKED: "PromiseFSM/events/locked",
		EXIT_STATE: "PromiseFSM/events/exitState",
		ENTER_STATE: "PromiseFSM/events/enterState",
		UNLOCKED: "PromiseFSM/events/unlocked",
		STATE_CHANGED: "PromiseFSM/events/stateChanged"
	};

	var errorNames = {
		ILLEGAL_TRANSITION: "ILLEGAL_TRANSITION",
		LOCKED: "LOCKED"
	};
	
	function StateMachineEvent(type, from, to) {
		this.type = type;
		this.from = from;
		this.to = to;
	}

	var promiseAdapter;
  var machines = {};

	return {
		EVENTS: eventNames,
		ERRORS: errorNames,
		setPromiseAdapter: function(adapter) {
			promiseAdapter = adapter;
		},
		create: function(name, options) {
			machines[name] = new StateMachine(name, options);
			return machines[name].getInterface();
		},
		getMachine: function(name) {
			var machine = machines[name];
			if(machine) {
				return machine.getInterface();
			} else {
				return undefined;
			}
		}
	};

}());

	PromiseFSM.setPromiseAdapter($q);

	return PromiseFSM;
}]);