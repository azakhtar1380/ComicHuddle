// Founder badge (owner id OR COMICHUDDLE_FOUNDER_EMAIL) and the display name / handle rules.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {founderEmail,isAdmin,isFounder} from '../lib/admin';
import {ownerAccountId} from '../lib/owner';
import {changesLeft,changesNote,offensiveReason,reservedReason,squash} from '../lib/name-rules';

test('founder: the owner account id, or the account whose email matches COMICHUDDLE_FOUNDER_EMAIL',()=>{
 const env={COMICHUDDLE_FOUNDER_EMAIL:'  Owner@Example.COM '};
 assert.equal(founderEmail(env),'owner@example.com');
 assert.equal(founderEmail({COMICHUDDLE_FOUNDER_EMAIL:'not an email'}),'');
 assert.equal(isFounder({userId:ownerAccountId},{}),true,'the owner id still counts');
 assert.equal(isFounder({userId:'qa-user',email:'OWNER@example.com'},env),true,'case-insensitive email match');
 assert.equal(isFounder({userId:'qa-user',email:'someone@example.com'},env),false);
 assert.equal(isFounder({userId:'qa-user',email:'owner@example.com'},{}),false,'no setting, no email founder');
 assert.equal(isAdmin({userId:'qa-user',email:'owner@example.com'},env),true,'the founder is always an admin');
});

test('names and handles: staff words and look-alikes, offensive words, and the changes-left note',()=>{
 assert.equal(squash('Adm1n_Supp0rt'),'adminsupport');
 for(const v of ['Founder','ComicHuddle Support','The Official Mike','adm1n','Comic Huddle'])assert.ok(reservedReason(v,'name'),v);
 for(const v of ['founder_x','mod','x_mod','comichuddle','0fficial'])assert.ok(reservedReason(v,'handle'),v);
 for(const v of ['Modern Mike','Peacock Comics','Dickens Fan','Hancock'])assert.equal(reservedReason(v,'name'),null,v);
 assert.equal(reservedReason('model_trains','handle'),null,'"mod" only as a whole part');
 assert.ok(offensiveReason('sh1t_lord'));assert.equal(offensiveReason('Scott Comics'),null);
 assert.deepEqual([changesLeft(0,2,false),changesLeft(1,2,false),changesLeft(5,2,false),changesLeft(9,2,true)],[2,1,0,null]);
 assert.deepEqual([changesNote(2),changesNote(1),changesNote(0),changesNote(null)],['2 changes left','1 change left','No changes left — contact support','']);
});
