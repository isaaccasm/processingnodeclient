exports.WISDMUSAGE=new WisdmUsage();

var common=require('./common').common;
var DATABASE=require('./databasemanager').DATABASE;

function WisdmUsage() {
	var that=this;
	
	this.setCollectionName=function(collection_name) {m_collection_name=collection_name;};
	this.addRecord=function(record) {_addRecord(record);};
	this.writePendingRecords=function(callback) {write_pending_records(callback);};
	this.startPeriodicWritePendingRecords=function(callback) {_startPeriodicWritePendingRecords(callback);};
	
	var m_pending_records=[];
	var m_collection_name='undefined';
	
	function _addRecord(record) {
		var rec=JSON.parse(JSON.stringify(record));
		rec.timestamp=(new Date()).getTime();
		m_pending_records.push(rec);
	}
	
	function write_pending_records(callback) {
		if (m_pending_records.length>0) {
			var DB=DATABASE('wisdmusage');
			var docs=[];
			common.for_each_async(m_pending_records,function(record,cb) {
				var doc={
					user_id:record.user_id||'unknown',
					usage_type:record.usage_type||'unknown',
					name:record.name||'unknown',
					hour:get_current_hour()
				};
				DB.setCollection(m_collection_name);
				DB.upsert(doc,{$inc:{amount:record.amount}},function(err) {
					if (err) {
						cb({success:false,error:'Error inserting usage record: '+err});
						return;
					}
					cb({success:true});
				});
			},function(tmp) {
				m_pending_records=[];
				if (callback) callback(tmp);
			},1);
		}
		else {
			if (callback) {callback({success:true});}
		}
	}
	function get_current_hour() {
		var dd=new Date();
		return dd.getFullYear()+'-'+('000'+(dd.getMonth()+1)).slice(-2)+'-'+('000'+(dd.getDate())).slice(-2)+'-'+('000'+(dd.getHours())).slice(-2);
	}
	
	function _startPeriodicWritePendingRecords(callback) {
		periodic_write_pending_records();
	}
	function periodic_write_pending_records() {
		write_pending_records(function(tmp) {
			if (!tmp.success) {
				console.error(tmp.error);
				setTimeout(periodic_write_pending_records,5000);
			}
			else {
				setTimeout(periodic_write_pending_records,1000);
			}
		});
	}
	
	/*
	function open_database(params,callback) {
		var db=new mongo.Db('wisdmusage', new mongo.Server('localhost',params.port||27017, {}), {safe:true});
		db.open(function(err,db) {
			if (err) {
				if (callback) callback(err,null);
			}
			else {
				if (callback) callback('',db);
			}
		});
	}
	*/
}

