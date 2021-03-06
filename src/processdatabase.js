
var common=require('./common').common;
var RunningProcess=require('./runningprocess').RunningProcess;
var fs=require('fs');
var WISDMUSAGE=require('./wisdmusage').WISDMUSAGE;
var DATABASE=require('./databasemanager').DATABASE;

function ProcessDatabase() {
	var that=this;
	
	this.setDatabaseName=function(database_name) {m_database_name=database_name; m_db=DATABASE(database_name);};
	this.addProcesses=function(processes,params,callback) {_addProcesses(processes,params,callback);};
	this.handleProcesses=function(callback) {_handleProcesses(callback);};
	this.setProcessWorkingPath=function(path) {m_process_working_path=path;};
	this.setProcessorWorkingPath=function(path) {m_processor_working_path=path;};
	this.setDataFilePath=function(path) {m_data_file_path=path;};
	this.checkProcessesComplete=function(params,callback) {_checkProcessesComplete(params,callback);};
	this.getProcessRecord=function(process_id,fields,callback) {_getProcessRecord(process_id,fields,callback);};
	this.getProcessRecords=function(query,fields,callback) {_getProcessRecords(query,fields,callback);};
	this.runningProcessCount=function() {var ret=0; for (var ppp in m_running_processes) {ret++;} return ret;};
	this.addScriptRecord=function(record,callback) {_addScriptRecord(record,callback);};
	this.setScriptOutput=function(output,callback) {_setScriptOutput(output,callback);};
	this.find=function(collection,query,fields,callback) {_find(collection,query,fields,callback);};
	this.remove=function(collection,selector,callback) {_remove(collection,selector,callback);};
	this.setMaxSimultaneousProcesses=function(num) {m_max_simultaneous_processes=num;};
	
	var m_db=null;
	var m_database_name='';
	var m_max_simultaneous_processes=1;
	var m_process_working_path='';
	var m_processor_working_path='';
	var m_data_file_path='';
	var m_running_processes={}; //by process id
	
	function _checkProcessesComplete(params,callback) {
		var script_id=params.script_id||'';
		
		var statuses=['pending','queued','running'];
		var complete=true;
		common.for_each_async(statuses,function(status,cb) {
			if (!complete) {
				cb({success:true});
				return;
			}
			var query0={status:status};
			if (script_id) query0.script_id=script_id;
			m_db.setCollection('processes');
			m_db.find(query0,{},function(err,docs) {
				if (err) {
					cb({success:false,error:err});
					return;
				}
				if (docs.length>0) complete=false;
				cb({success:true});
			});
		},finalize_check,1);
		
		function finalize_check(tmp) {
			if (!tmp.success) {
				callback(tmp);
				return;
			}
			callback({success:true,complete:complete});
		}
	}
	
	function _getProcessRecord(process_id,fields,callback) {
		m_db.setCollection('processes');
		m_db.find({_id:process_id},fields,function(err,docs) {
			if (err) {
				callback({success:false,error:'Problem in getProcessRecord: '+err});
				return;
			}
			if (docs.length===0) {
				callback({success:false,error:'Problem in getProcessRecord: not found: '+process_id});
				return;
			}
			callback({success:true,record:docs[0]});
		});
	}
	function _getProcessRecords(query,fields,callback) {
		m_db.setCollection('processes');
		m_db.find(query,fields,function(err,docs) {
			if (err) {
				callback({success:false,error:'Problem in getProcessRecords: '+err});
				return;
			}
			callback({success:true,records:docs});
		});
	}
	
	function _find(collection,query,fields,callback) {
		m_db.setCollection(collection);
		m_db.find(query,fields,function(err,docs) {
			if (err) {
				callback({success:false,error:'Problem in find: '+err});
				return;
			}
			callback({success:true,docs:docs});
		});
	}
	
	function _remove(collection,selector,callback) {
		m_db.setCollection(collection);
		m_db.remove(selector,function(err,docs) {
			if (err) {
				callback({success:false,error:'Problem in remove: '+err});
				return;
			}
			callback({success:true});
		});
	}
	
	function _addScriptRecord(record,callback) {
		record._id=record.script_id||'';
		record.timestamps={};
		record.timestamps.submitted=(new Date()).getTime();
		record.timestamps.submitted_h=dateFormat();
		m_db.setCollection('scripts');
		m_db.insert(record,function(err) {
			if (err) callback({success:false,error:err});
			else callback({success:true});
		});
	}
	
	function _setScriptOutput(output,callback) {
		m_db.setCollection('scripts');
		m_db.update({_id:output.script_id},{$set:{output:output.output,submitted_processes:output.submitted_processes}},function(err) {
			if (err) {
				if (callback) callback({success:false,error:'Problem setting script output: '+err});
				return;
			}
			if (callback) callback({success:true});
		});
	}
	
	function _addProcesses(processes,params,callback) {
		
		var previous_statuses={};
		var process_docs_to_save=[];
		var processor_docs_to_save=[];
		var processor_ids_to_save={};
		for (var process_id in processes) {
			var process=processes[process_id];
			var P0={};
			P0.input_files=process.input_files||{};
			P0.input_parameters=common.extend(true,{},process.input_parameters||{});
			P0.processor_id=(process.processor||{}).processor_id||'';
			P0._id=process_id;
			P0.status='pending';
			P0.script_id=process.script_id||'';
			P0.user_id=params.user_id;
			process_docs_to_save.push(P0);
			
			if (!(P0.processor_id in processor_ids_to_save)) {
				processor_ids_to_save[P0.processor_id]=true;
				var R0=common.extend(true,{},process.processor||{});
				R0.user_id=params.user_id;
				R0._id=R0.processor_id;
				processor_docs_to_save.push(R0);
			}
		}
		
		save_processor_docs(function(tmp1) {
			if (tmp1.success) {
				save_process_docs(callback);
			}
			else callback(tmp1);
		});
		
		function save_processor_docs(callback) {
			if (processor_docs_to_save.length>0) {
				
				WISDMUSAGE.addRecord({
					usage_type:'processes_submitted',
					user_id:params.user_id||'unknown',
					amount:processor_docs_to_save.length,
					processing_node_id:'',
					name:''
				});
				
				common.for_each_async(processor_docs_to_save,function(doc,cb) {
					m_db.setCollection('processors');
					m_db.save(doc,function(err) {
						if (err) cb({success:false,error:err});
						else cb({success:true});
					});
				},callback,5);
			}
			else callback({success:true});
		}
		function save_process_docs(callback) {
			if (process_docs_to_save.length>0) {
				common.for_each_async(process_docs_to_save,function(doc,cb) {
					m_db.setCollection('processes');
					m_db.find({_id:doc._id},{},function(err,matching_docs) {
						if (err) {
							report_error(cb,'Database error in find: '+err);
							return;
						}
						if (matching_docs.length===0) {
							doc.timestamps={};
							doc.timestamps.submitted=(new Date()).getTime();
							doc.timestamps.submitted_h=dateFormat();
							m_db.setCollection('processes');
							m_db.save(doc,function(err) {
								if (err) cb({success:false,error:err});
								else cb({success:true});
							});
						}
						else {
							var status0=matching_docs[0].status||'';
							if ((status0=='pending')||(status0=='queued')||(status0=='running')||(status0=='finished')) {
								previous_statuses[doc._id]=status0;
								cb({success:true});
							}
							else {
								doc.timestamps={};
								doc.timestamps.submitted=(new Date()).getTime();
								doc.timestamps.submitted_h=dateFormat();
								m_db.setCollection('processes');
								m_db.save(doc,function(err) {
									if (err) cb({success:false,error:err});
									else cb({success:true});
								});
							}
						}
					});
				},function() {
					callback({success:true,previous_statuses:previous_statuses});
				},5);
			}
			else callback({success:true,previous_statuses:previous_statuses});
		}
	}
	
	function report_error(callback,errstr) {
		console.error('ERROR: '+errstr);
		if (callback) callback({success:false,error:errstr});
	}
	
	function _handleProcesses(callback) {
		var ret={success:true};
		ret.num_queued=0;
		ret.num_launched=0;
		ret.num_completed=0;
		
		//do it twice!
		do_handle_processes(function() {
			do_handle_processes(function() {
				ret.success=true;
				callback(ret);
			});
		});
		
		function do_handle_processes(callback2) {
			queue_pending_processes_that_are_ready(function(tmp1) {
				if (!tmp1.success) {
					report_error(callback,'Problem queueing pending processes: '+tmp1.error);
					return;
				}
				handle_running_processes(function(tmp3) { //perhaps important to handle running processes before launching queued processes, so we can make sure to first remove any running processes that are no longer in the database
					if (!tmp3.success) {
						report_error(callback,'Problem handling running processes: '+tmp3.error);
						return;
					}
					launch_queued_processes_that_are_ready(function(tmp2) {
						if (!tmp2.success) {
							report_error(callback,'Problem launching queued processes: '+tmp2.error);
							return;
						}
						
						ret.num_queued+=tmp1.num_queued;
						ret.num_launched+=tmp2.num_launched;
						ret.num_completed+=tmp3.num_completed;
					
						callback2();
					});
				});
			});
		}
	}
	
	function launch_queued_processes_that_are_ready(callback) {
		var num_launched=0;
		m_db.setCollection('processes');
		m_db.find({status:'running'},{},function(err,running_processes) {
			if (err) {
				report_error(callback,'Problem finding running processes: '+err);
				return;
			}
			
			var num_running_processes=running_processes.length;
			
			if (num_running_processes>=m_max_simultaneous_processes) {
				callback({success:true});
				return;
			}
			
			m_db.setCollection('processes');
			m_db.find({status:'queued'},{},function(err,queued_processes) {
				if (err) {
					report_error(callback,'Problem finding queued processes: '+err);
					return;
				}
				
				var ind=0;
				launch_next();
				
				function launch_next() {
					if (ind>=queued_processes.length) {
						if (num_launched>0) console.log (num_launched+' PROCESSES LAUNCHED.');
						callback({success:true,num_launched:num_launched});
						return;
					}
					
					if (num_running_processes>=m_max_simultaneous_processes) {
						if (num_launched>0) console.log (num_launched+' PROCESSES LAUNCHED.');
						callback({success:true});
						return;
					}
					
					var process=queued_processes[ind];
					check_if_process_is_ready_to_be_queued(process,function(ready) {
						if (ready) {
							m_db.setCollection('processes');
							m_db.update({_id:process._id},{$set:{status:'running',launched:false,'timestamps.running':(new Date()).getTime()}},function(err) {
								if (err) {
									report_error(callback,'Problem updating status to running: '+err);
									return;
								}
								num_running_processes++;
								
								var processor_id=process.processor_id;
								m_db.setCollection('processors');
								m_db.find({_id:processor_id},{},function(err,processor_docs) {
									if ((err)||(processor_docs.length===0)) {
										move_to_error('Unable to find processor: '+processor_id);
										return;
									}
									var processor=processor_docs[0];
								
									try {
										do_launch_process(process,processor,function(tmp2) {
											if (tmp2.success) {
												m_db.setCollection('processes');
												m_db.update({_id:process._id},{$set:{launched:true,'timestamps.launched':(new Date()).getTime()}},function(err) {
													num_launched++;
													ind++; launch_next();
												});
											}
											else {
												move_to_error(tmp2.error);
											}
										});
									}
									catch(err) {
										move_to_error(err.message||'');
									}
								});
							});
						}
						else { //not ready
							move_to_error('Process no longer ready to be queued.');
						}
					});
					
					function move_to_error(errstr) {
						console.log ('MOVING PROCESS TO ERROR: '+errstr);
						m_db.setCollection('processes');
						m_db.update({_id:process._id},{$set:{status:'error',error:errstr,'timestamps.error':(new Date()).getTime()}},function(err) {
							if (err) {
								report_error(callback,'Problem updating status to error *: '+err);
								return;
							}
	
							ind++; launch_next();
						});
					}
					
				}
			});
		});
	}
	function do_launch_process(process,processor,callback) {
		if (!process._id) {
			report_error(callback,'In do_launch_process, process._id is empty');
			return;
		}
		if (!m_process_working_path) {
			report_error(callback,'In do_launch_process, m_process_working_path is empty');
			return;
		}
		if (!m_processor_working_path) {
			report_error(callback,'In do_launch_process, m_processor_working_path is empty');
			return;
		}
		
		create_and_clear_process_folder(function(tmp1) {
			if (!tmp1.success) {
				report_error(callback,'Problem creating working folder: '+tmp1.error);
				return;
			}
			
			update_processor_files(function(tmp2) {
				if (!tmp2.success) {
					report_error(callback,'Problem writing processor files: '+tmp2.error);
					return;
				}
				
				WISDMUSAGE.addRecord({
					usage_type:'processes_launched',
					user_id:process.user_id||'unknown',
					amount:1,
					processing_node_id:'',
					name:processor.processor_name||'unknown_name'
				});
				
				execute_process(function(tmp3) {
					if (!tmp3.success) {
						report_error(callback,'Problem executing process: '+tmp3.error);
						return;
					}
					
					callback({success:true});
				});
			});
		});
		
		function create_and_clear_process_folder(cb) {
			common.mkdir(m_process_working_path+'/'+process._id,function(tmp) {
				if (!tmp.success) {
					report_error(cb,'Problem with mkdir: '+tmp.error);
					return;
				}
				
				clear_folder(m_process_working_path+'/'+process._id,function(tmp) {
					if (!tmp.success) {
						report_error(cb,'Problem clearing folder: '+tmp.error);
						return;
					}
					
					cb({success:true});
				});
				
			});
		}
		function clear_folder(path,cb) {
			common.get_dir_list(path,function(tmp) {
				common.for_each_async(tmp.files,function(file,cb2) {
					fs.unlink(path+'/'+file,function(err) {
						if (err) {
							report_error(cb2,'Unable to remove file: '+file+': '+err);
							return;
						}
						
						cb2({success:true});
					});
				},remove_folders,5);
				
				function remove_folders(tmp2) {
					if (!tmp2.success) {
						report_error(cb,tmp2.error);
						return;
					}
					
					common.for_each_async(tmp.dirs,function(folder,cb2) {
						clear_folder(path+'/'+folder,function(tmp3) {
							if (!tmp3.success) {
								report_error(cb2,tmp3.error);
								return;
							}
							fs.rmdir(path+'/'+folder,function(err) {
								if (err) {
									report_error(cb2,'Unable to remove folder: '+folder+': '+err);
									return;
								}
								cb2({success:true});
							});
						});
					},step3,5);
				}
				
				function step3(tmp4) {
					if (!tmp4.success) {
						report_error(cb,tmp4.error);
						return;
					}
					cb({success:true});
				}
			});
		}
		function get_file_path(path) {
			var ind=path.lastIndexOf('/');
			if (ind<0) return '';
			return path.slice(0,ind);
		}
		function update_processor_files(cb) {
			
			var path=m_processor_working_path+'/'+processor.processor_id;
			common.mkdir(path,function(tmp) {
				if (!tmp.success) {
					report_error(cb,'Unable to create processor working folder.');
					return;
				}
				var files=processor.files||[];
				common.for_each_async(files,function(file,cb2) {
					if (!file) {
						report_error(cb,'unexpected: file is undefined.');
						return;
					}
					var path0=path+'/'+(file.path||'<undefined>');
					common.read_text_file(path0,function(tmp) {
						if ((tmp.text)&&(tmp.text==file.content)) {
							cb2({success:true});
						}
						else {
							common.create_path(get_file_path(path0),path,function(tmp) {
								if (!tmp.success) {
									report_error(cb2,'Unable to create path: '+tmp.error);
									return;
								}
								common.write_text_file(path0,file.content,function(tmp) {
									cb2(tmp);
								});
							});
						}
					});
				},finalize_update_processor_files,5);
			});
			
			function finalize_update_processor_files(tmp) {
				if (!tmp.success) {
					report_error(cb,tmp.error);
					return;
				}
				
				cb({success:true});
			}
		}
		function execute_process(cb) {
			var process_id=process._id;
			if (process_id in m_running_processes) {
				report_error(cb,'Unexpected problem: process already running: '+process_id);
				return;
			}
			var processor_id=process.processor_id||'';
			
			var RP=new RunningProcess();
			RP.setProcess(process);
			RP.setProcessor(processor);
			RP.setProcessWorkingPath(m_process_working_path+'/'+process_id);
			RP.setProcessorWorkingPath(m_processor_working_path+'/'+processor_id);
			RP.setDataFilePath(m_data_file_path);
			RP.setProcessDatabaseName(m_database_name);
			RP.start(function(tmp) {
				if (!tmp.success) {
					report_error(cb,'Problem starting process: '+tmp.error);
					return;
				}
				if (process_id in m_running_processes) {
					report_error(cb,'Unexpected problem: process already running ***: '+process_id);
					return;
				}
				m_running_processes[process_id]=RP;
				cb({success:true});
			});
		}
	}
	
	function queue_pending_processes_that_are_ready(callback) {
		
		m_db.setCollection('processes');
		m_db.find({status:'pending'},{},function(err,pending_processes) {
			if (err) {
				report_error(callback,'Problem finding pending processes: '+err);
				return;
			}
			
			var num_queued=0;
			common.for_each_async(pending_processes,function(pending_process,cb) {
				check_if_process_is_ready_to_be_queued(pending_process,function(ready) {
					if (ready) {
						m_db.setCollection('processes');
						m_db.update({_id:pending_process._id},{$set:{status:'queued','timestamps.queued':(new Date()).getTime()}},function(err) {
							if (err) {
								report_error(cb,'Problem moving pending to queued: '+err);
								return;
							}
							num_queued++;
							cb({success:true});
						});
					}
					else {
						cb({success:true});
					}
				});
			},function(tmp) {
				if (!tmp.success) {
					report_error(callback,tmp.error);
					return;
				}
				if (num_queued>0) {
					console.log (num_queued+' PROCESSES QUEUED.');
				}
				if (callback) callback({success:true,num_queued:num_queued});
			},5);
		});
	}
	
	function check_if_process_is_ready_to_be_queued(process,callback) {
		var input_files=process.input_files||{};
		var input_file_list=[];
		for (var input_file_name in input_files) {
			var input_file=input_files[input_file_name];
			if (input_file.length) {
				for (var j=0; j<input_file.length; j++) {
					input_file_list.push(input_file[j]);
				}
			}
			else {
				input_file_list.push(input_file);
			}
		}

		var is_ready=true;
		common.for_each_async(input_file_list,function(input_file,cb) {
			if (!is_ready) {
				//skip to the next one
				cb({success:true});
			}
			else {
				check_if_input_file_is_ready(input_file,function(ready0) {
					if (!ready0) is_ready=false;
					cb({success:true});
				});
			}
		},function(tmp) {
			callback(is_ready);
		},5);
		
		function check_if_input_file_is_ready(input_file,cb2) {
			if (input_file.content) {
				cb2(true);
			}
			else if (input_file.process_id) {
				m_db.setCollection('processes');
				m_db.find({_id:input_file.process_id},{},function(err,docs) {
					if (err) {
						cb2(false);
					}
					else {
						if (docs.length===0) {
							cb2(false);
						}
						else {
							var status1=docs[0].status||'';
							if (status1=='finished') {
								cb2(true);
							}
							else {
								cb2(false);
							}
						}
					}
				});
			}
			else {
				cb2({success:false});
			}
		}
	}
	
	function handle_running_processes(callback) {
		var num_completed=0;
		
		m_db.setCollection('processes');
		m_db.find({status:'running'},{},function(err,running_processes) {
			if (err) {
				report_error(callback,'Problem finding running processes +:'+err);
				return;
			}
			
			//delete the running processes that are not in the database
			var running_process_ids={};
			running_processes.forEach(function(process) {
				running_process_ids[process._id]=1;
			});
			for (var rpid in m_running_processes) {
				if (!running_process_ids[rpid]) {
					console.log ('deleting process not in database: '+rpid);
					delete m_running_processes[rpid];
				}
			}
			
			common.for_each_async(running_processes,handle_running_process,function(tmp11) {
				if (tmp11.success) {
					callback({success:true,num_completed:num_completed});
				}
				else {
					callback(tmp11);
				}
			},5);
			
		});
		
		function handle_running_process(process,cb) {
			var process_id=process._id;
			if (process_id in m_running_processes) {
				var RP=m_running_processes[process_id];
				if ((RP.processStatus()=='finished')||(RP.processStatus()=='error')) {
					num_completed++;
					on_process_completed(process_id,cb);
				}
				else {
					//must still be running
					cb({success:true});
				}
			}
			else {
				//not found in running processes... move it back to queued
				console.log ('Process not found in running processes... killing and moving to error: '+process_id);
				kill_process_by_pid(process.pid,function() {
					m_db.setCollection('processes');
					m_db.update({_id:process_id},{$set:{status:'error',error:'process not found in running processes, perhaps the WISDM server restarted while this processing was running.','timestamps.error':(new Date()).getTime()}},function(err) {
						if (err) {
							cb({success:false,error:'Problem changing status from running to error: '+err}); 
							return;
						}
						cb({success:true});
					});
				});
			}
		}
	}
	
	function kill_process_by_pid(pid,callback) {
		if (!pid) {
			console.error('pid is empty in kill_process_by_pid');
			if (callback) callback();
			return;
		}
		//kill the child processes via "-P", because the main process is the bash script!!!
		require('child_process').exec('pkill -P '+pid,function(err,stdout,stderr) {
			if (err) console.error('Error in kill: '+err);
			if (stdout) console.log ('kill stdout: '+stdout);
			if (stderr) console.log ('kill stderr: '+stderr);
			if (callback) callback();
			return;
		});
	}
	
	function on_process_completed(process_id,callback) {
		if (!(process_id in m_running_processes)) {
			report_error(callback,'Unexpected problem in on_process_completed: process not found in running processes: '+process_id);
			return;
		}
		
		
		var RP=m_running_processes[process_id];
		
		WISDMUSAGE.addRecord({
			usage_type:'processes_completed',
			user_id:RP.process().user_id||'unknown',
			amount:1,
			processing_node_id:'',
			name:''
		});
		var elapsed=(new Date())-RP.timeLaunched();
		WISDMUSAGE.addRecord({
			usage_type:'process_time',
			user_id:RP.process().user_id||'unknown',
			amount:elapsed,
			processing_node_id:'',
			name:''
		});
		
		var status=RP.processStatus();
		var obj={status:status};
		obj.process_output=RP.processOutput();
		if (status=='finished') {
			obj.output_files=RP.outputFiles();
		}
		else if (status=='error') {
			obj.error=RP.processError();
		}
		if (status=='finished') obj['timestamps.finished']=(new Date()).getTime();
		else if (status=='error') obj['timestamps.error']=(new Date()).getTime();
		m_db.setCollection('processes');
		m_db.update({_id:process_id},{$set:obj},function(err) {
			if (err) {
				report_error(callback,'Problem updating status on completed: '+err);
				return;
			}
			console.log ('PROCESS COMPLETED: status='+status);
			delete m_running_processes[process_id];
			callback({success:true});
		});
	}
	
}



/*
 * Date Format 1.2.3
 * (c) 2007-2009 Steven Levithan <stevenlevithan.com>
 * MIT license
 *
 * Includes enhancements by Scott Trenda <scott.trenda.net>
 * and Kris Kowal <cixar.com/~kris.kowal/>
 *
 * Accepts a date, a mask, or a date and a mask.
 * Returns a formatted version of the given date.
 * The date defaults to the current date/time.
 * The mask defaults to dateFormat.masks.default.
 */

var dateFormat = function () {
	var	token = /d{1,4}|m{1,4}|yy(?:yy)?|([HhMsTt])\1?|[LloSZ]|"[^"]*"|'[^']*'/g,
		timezone = /\b(?:[PMCEA][SDP]T|(?:Pacific|Mountain|Central|Eastern|Atlantic) (?:Standard|Daylight|Prevailing) Time|(?:GMT|UTC)(?:[-+]\d{4})?)\b/g,
		timezoneClip = /[^-+\dA-Z]/g,
		pad = function (val, len) {
			val = String(val);
			len = len || 2;
			while (val.length < len) val = "0" + val;
			return val;
		};

	// Regexes and supporting functions are cached through closure
	return function (date, mask, utc) {
		var dF = dateFormat;

		// You can't provide utc if you skip other args (use the "UTC:" mask prefix)
		if (arguments.length == 1 && Object.prototype.toString.call(date) == "[object String]" && !/\d/.test(date)) {
			mask = date;
			date = undefined;
		}

		// Passing date through Date applies Date.parse, if necessary
		date = date ? new Date(date) : new Date;
		if (isNaN(date)) throw SyntaxError("invalid date");

		mask = String(dF.masks[mask] || mask || dF.masks["default"]);

		// Allow setting the utc argument via the mask
		if (mask.slice(0, 4) == "UTC:") {
			mask = mask.slice(4);
			utc = true;
		}

		var	_ = utc ? "getUTC" : "get",
			d = date[_ + "Date"](),
			D = date[_ + "Day"](),
			m = date[_ + "Month"](),
			y = date[_ + "FullYear"](),
			H = date[_ + "Hours"](),
			M = date[_ + "Minutes"](),
			s = date[_ + "Seconds"](),
			L = date[_ + "Milliseconds"](),
			o = utc ? 0 : date.getTimezoneOffset(),
			flags = {
				d:    d,
				dd:   pad(d),
				ddd:  dF.i18n.dayNames[D],
				dddd: dF.i18n.dayNames[D + 7],
				m:    m + 1,
				mm:   pad(m + 1),
				mmm:  dF.i18n.monthNames[m],
				mmmm: dF.i18n.monthNames[m + 12],
				yy:   String(y).slice(2),
				yyyy: y,
				h:    H % 12 || 12,
				hh:   pad(H % 12 || 12),
				H:    H,
				HH:   pad(H),
				M:    M,
				MM:   pad(M),
				s:    s,
				ss:   pad(s),
				l:    pad(L, 3),
				L:    pad(L > 99 ? Math.round(L / 10) : L),
				t:    H < 12 ? "a"  : "p",
				tt:   H < 12 ? "am" : "pm",
				T:    H < 12 ? "A"  : "P",
				TT:   H < 12 ? "AM" : "PM",
				Z:    utc ? "UTC" : (String(date).match(timezone) || [""]).pop().replace(timezoneClip, ""),
				o:    (o > 0 ? "-" : "+") + pad(Math.floor(Math.abs(o) / 60) * 100 + Math.abs(o) % 60, 4),
				S:    ["th", "st", "nd", "rd"][d % 10 > 3 ? 0 : (d % 100 - d % 10 != 10) * d % 10]
			};

		return mask.replace(token, function ($0) {
			return $0 in flags ? flags[$0] : $0.slice(1, $0.length - 1);
		});
	};
}();

// Some common format strings
dateFormat.masks = {
	"default":      "ddd mmm dd yyyy HH:MM:ss",
	shortDate:      "m/d/yy",
	mediumDate:     "mmm d, yyyy",
	longDate:       "mmmm d, yyyy",
	fullDate:       "dddd, mmmm d, yyyy",
	shortTime:      "h:MM TT",
	mediumTime:     "h:MM:ss TT",
	longTime:       "h:MM:ss TT Z",
	isoDate:        "yyyy-mm-dd",
	isoTime:        "HH:MM:ss",
	isoDateTime:    "yyyy-mm-dd'T'HH:MM:ss",
	isoUtcDateTime: "UTC:yyyy-mm-dd'T'HH:MM:ss'Z'"
};

// Internationalization strings
dateFormat.i18n = {
	dayNames: [
		"Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat",
		"Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"
	],
	monthNames: [
		"Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
		"January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"
	]
};

// For convenience...
Date.prototype.format = function (mask, utc) {
	return dateFormat(this, mask, utc);
};











exports.ProcessDatabase=ProcessDatabase;