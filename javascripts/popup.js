var background;

var isDebug = true && commonDebug;
var isDebugToBg =  true && isDebug;

// amount of vertical viewport size to add for preloading notes in index
var preLoadFactor = 1/4;
var currentView = "index";
var slideEasing = "swing"; // swing or linear
var slideDuration = 200;
var isTab = false;
var editorSaveTime = 3000;
var snEditor;
var snIndex;

//  ---------------------------------------
var fontUrls = {
    "Droid Sans Mono"   : '<link href="http://fonts.googleapis.com/css?family=Droid+Sans+Mono:regular" rel="stylesheet" type="text/css" >',
    "Walter Turncoat"   : '<link href="http://fonts.googleapis.com/css?family=Walter+Turncoat:regular" rel="stylesheet" type="text/css" >',
    "Inconsolata"       : '<link href="http://fonts.googleapis.com/css?family=Inconsolata:regular" rel="stylesheet" type="text/css" >',
    "Lekton"            : '<link href="http://fonts.googleapis.com/css?family=Lekton" rel="stylesheet" type="text/css">',
    "Yanone Kaffeesatz" : '<link href="http://fonts.googleapis.com/css?family=Yanone+Kaffeesatz:300" rel="stylesheet" type="text/css" >',
    "Vollkorn"          : '<link href="http://fonts.googleapis.com/css?family=Vollkorn:regular" rel="stylesheet" type="text/css" >'
}

function log(s) {
    if (isDebug)
        logGeneral(s,"popup.js",console);
    if (isDebugToBg)
        logGeneral(s,"popup.js",background.console);
}

//  ---------------------------------------
// event listener for popup close
// defer save to background
addEventListener("unload", unloadListener, true);

function unloadListener() {
    if (snEditor.isNoteDirty()) {
        var note = {};
        log("(unload): requesting background save");

        if (snEditor.dirty.content)
            note.content = snEditor.codeMirror.getCode();
        if (snEditor.dirty.pinned) {
            snEditor.needCMRefresh("pinned");
            note.systemtags = snEditor.note.systemtags;
            if (!snEditor.isPintoggle()) {
                note.systemtags.splice(note.systemtags.indexOf("pinned"),1);
            } else {
                note.systemtags.push("pinned");
            }
        }
        if (snEditor.dirty.tags)
            note.tags = snEditor.getTags();
//        if ($('div#note input#encrypted').attr("dirty")=="true")
//            note.encrypted = $('div#note input#encrypted')?1:0;

        note.key = snEditor.note.key;

        log("(unload): note:");
        log(note);

        background.saveNote = note;
    } else
        log("(unload): no background save");

    snEditor.saveCaretScroll();

    if (isTab)
        delete background.popouttab;

    background.setTimeout("popupClosed()", 1);
}

//  ---------------------------------------
//  event listener for "uiEvents" (anything background->popup)
//
// {name:"sync", status: "started|done|error", changes : {hadchanges: false|true, added:[keys],changed:[keys],deleted:[keys]}}
// {name:"noteadded", note:{note}}
// {name:"notedeleted", key: key}
// {name:"noteupdated", newnote:{note}, oldnote: {note}, changes:{hadChanges: false|true, added:[fields],changed:[fields], deleted:[fields]}}
// {name:"offlinechanged", status:true|false}
// {name:"synclistchanged", added|removed:key}
var syncInProgress = false;
function uiEventListener(eventData, sender, sendResponse) {
    var eventName = eventData.name;
//    if (syncInProgress && (eventName == "noteadded" || eventName == "noteupdated" || eventName == "notedeleted"))
//            return;

    if (eventName == "sync") {

        log("EventListener:sync:" + eventData.status + ", hadChanges=" + eventData.changes.hadchanges );

        if (eventData.status == "started") {
            syncInProgress = true;
            $("#sync").html(chrome.i18n.getMessage("sync_in_progress"));
        } else if (eventData.status == "done") {
            syncInProgress = false;
            if (eventData.changes.hadchanges) {
                fillTags(true);
                $("#sync").html(chrome.i18n.getMessage("sync_done_had_changes"));
            } else {
                $("#sync").html(chrome.i18n.getMessage("sync_done"));
            }
        } else if (eventData.status == "error") {
            syncInProgress = false;
            $("#sync").html(chrome.i18n.getMessage("sync_error")+ ": " + eventData.errorstr);
        }

    } else if (eventName == "noteadded") {
        log("EventListener:" + eventName);
        fillTags(true);
//        if (!eventData.note.key.match(/created/))
//             SNEditor.setNote(eventData.note);
    } else if (eventName == "noteupdated") {
        log("EventListener:noteupdated, source=" + eventData.source + ", changed=[" + eventData.changes.changed.join(",") + "]");
        log("EventListener:noteupdated, syncNote=" + eventData.newnote._syncNote);
        var pinnedNowOn = eventData.changes.changed.indexOf("systemtags")>=0 && eventData.oldnote.systemtags.indexOf("pinned")<0 && eventData.newnote.systemtags.indexOf("pinned")>=0;
        var pinnedNowOff = eventData.changes.changed.indexOf("systemtags")>=0 && eventData.oldnote.systemtags.indexOf("pinned")>=0 && eventData.newnote.systemtags.indexOf("pinned")<0;
        var modifyChanged = eventData.changes.changed.indexOf("modifydate")>=0;
        var deleted = eventData.changes.changed.indexOf("deleted")>=0 && eventData.oldnote.deleted == 0 && eventData.newnote.deleted == 1;
        var undeleted = eventData.changes.changed.indexOf("deleted")>=0 && eventData.oldnote.deleted == 1 && eventData.newnote.deleted == 0;
        
        if (deleted) {
            if (noteRowCurrentlyVisible(eventData.newnote.key)) {
                $('div.noterow#' + eventData.newnote.key).hide("slow", function() {$(this).remove();});
            }
            if (localStorage.lastopennote_key == eventData.newnote.key) {
                delete localStorage.lastopennote_key
                snEditor.needCMRefresh("lastopen");
            }
            if (eventData.newnote.systemtags.indexOf("pinned")>=0)
                snEditor.needCMRefresh("pinned");
            
            fillTags(false);
        } else if (undeleted) {
            if (noteRowCurrentlyVisible(eventData.newnote.key)) {
                $('div.noterow#' + eventData.newnote.key).hide("slow", function() {$(this).remove();});
            }
            if (eventData.newnote.systemtags.indexOf("pinned")>=0)
                snEditor.needCMRefresh("pinned");
            
            fillTags(false);
        } else if (eventData.changes.changed.indexOf("tags")>=0) {
            fillTags(true);
        } else if (modifyChanged || pinnedNowOn || pinnedNowOff) {
            indexAddNote("replace", eventData.newnote);
            indexFillNote(eventData.newnote);
            if ($("#" + eventData.newnote.key).index()>0 || pinnedNowOff) {
                fillTags(true);
//                if (!isInView($('#' + note.key))) {
//                    log("scrolling to note")
//                    $('#notes').scrollTo($('#' + note.key),{duration:250})
//                }
            }
//                resort(function() {
//                            chrome.extension.sendRequest({action:"note", key:eventData.newnote.key}, function(note){
//                                if (note._syncNote)
//                                     $('div#' + note.key + "heading").addClass("syncnote");
//                                else
//                                     $('div#' + note.key + "heading").removeClass("syncnote");
//                                $("#"+note.key+"time").unbind();
//                                $("#"+note.key+"time").timeago();
//                                if (!isInView($('#' + note.key))) {
//                                    log("scrolling to note")
//                                    $('#notes').scrollTo($('#' + note.key),{duration:250})
//                                }
//                            });
//
//                    });
        } else {
            indexAddNote("replace", eventData.newnote);
            indexFillNote(eventData.newnote);
        }
        
        if (pinnedNowOn || pinnedNowOff) {
            $('div.noterow#' + eventData.newnote.key + "pin").attr("class",eventData.newnote.systemtags.indexOf("pinned")>=0?"pinned":"unpinned");
            snEditor.needCMRefresh("pinned");
        }
        
        if (isTab) {
            if ((pinnedNowOn || pinnedNowOff) && snEditor && snEditor.note && snEditor.note.key == eventData.newnote.key)
                snEditor.setPintoggle(eventData.newnote.systemtags.indexOf("pinned")>=0);
        }
        if (eventData.source != "local" && snEditor && snEditor.note && snEditor.note.key == eventData.newnote.key) {

                var contentChanged = eventData.changes.added.indexOf("content")>=0;
                var tagsChanged = eventData.changes.changed.indexOf("tags")>=0;
                if ( pinnedNowOn || pinnedNowOff || contentChanged || tagsChanged )
                    snEditor.setNote(eventData.newnote);
        }
    } else if (eventName == "offlinechanged") {
        log("EventListener:offline:" + eventData.status);
        if (eventData.status)
            $("#offline").html("offline mode");
        else
            $("#offline").html("");
    } else if (eventName == "synclistchanged") {
        if (eventData.added) {
            $('div#' + eventData.added + "heading").addClass("syncnote");
            log("EventListener:synclistchanged, added=" + eventData.added);
        }
        if (eventData.removed) {
            $('div#' + eventData.removed + "heading").removeClass("syncnote");
            log("EventListener:synclistchanged, removed=" + eventData.removed);
        }
        //log("length=" + $('div#' + eventData.removed + "heading").length)
    } else if (eventName == "notedeleted") {
        log("EventListener:notedeleted:" + eventData.key);
        $('div.noterow#' + eventData.key).remove();
    } else {
        log("EventListener:" + eventName);
    }
    snEditor.hideIfNotInIndex();
}

function noteRowCurrentlyVisible(key) {
    return $('div.noterow#' + key).length > 0;
}

// shortcuts
$(document).keydown(shorcuts);
function shorcuts(event) {

    if (event.altKey && !event.ctrlKey && !event.shiftKey)
        switch(event.keyCode) {
            case 88: //alt-x
                window.close();
            break
        }


    if (currentView=="index" || isTab) {
    // - index:
        var notesheight = $("div#notes").get(0).scrollHeight;

        if (event.altKey && !event.ctrlKey && !event.shiftKey)
            switch(event.keyCode) {
                case 38: //alt-up
                    $("div#notes").scrollTop($("div#notes").scrollTop()-notesheight/20)
                break;
                case 40: //alt-down
                    $("div#notes").scrollTop($("div#notes").scrollTop()+notesheight/20)
                break;
                case 39: //alt-right
                break;
                case 65: //alt-a
                    event.preventDefault();
                    $("div#index #add").click();
                    break;
                case 78: //alt-n
                    event.preventDefault();
                    $("div#index #notetags").focus();
                    break;
                case 81: //alt-q
                    event.preventDefault();
                    $("div#index input#q").focus();
                    break;

            }
    }
    
    if (currentView=="editor" || isTab) {
        // - editor: 
        if (event.altKey && !event.shiftKey && !event.ctrlKey)
            switch(event.keyCode) {
                case 83: //alt-s
                    snEditor.searchForSelection();break;
                case 86: //alt-v
                    snEditor.insertUrl();break;
                case 66: //alt-b
                    $('div#note #backtoindex').click();break;
                case 82: //alt-r
                    $('div#note #undo').click();break;
                case 79: //alt-o
                    if (!isTab) $('div#note #popout').click();break;
                case 80: //alt-p
                    $('div#note #pintoggle').click();
                    break;
                case 87: //alt-w                    
                    $("div#note #wraptoggle").click();
                    break;
                case 84: //alt-t
                    $("div#note input#tags").focus();
                    event.preventDefault();                    
                    break;
                case 69: //alt-e
                    snEditor.focus();
                    event.preventDefault();                    
                    break;
            }
        if (event.altKey && !event.shiftKey && event.ctrlKey)
            switch(event.keyCode) {                                                    
                case 68: //crtl-alt-d                    
                    $('#trash').click();break;
            }
    }
}

//  ---------------------------------------
$(document).ready(readyListener);

function readyListener() {

    background = chrome.extension.getBackgroundPage();
    chrome.browserAction.setBadgeText({text:""}); // reset badge

    if (!background) {
        console.log("deferring listener a bit");        
        setTimeout("readyListener()",1000);
    }
    
    chrome.tabs.getCurrent(function(tab) {
            if (tab) {
                log("---------------- tab opened ---------------------");
                background.popouttab = tab;
                isTab = true;
            } else {
                log("---------------- popup opened ---------------------");
                if (background.popouttab) {
                    log("--> deferring to tab");
                    chrome.tabs.update(background.popouttab.id, {selected:true, pinned:localStorage.option_pinnedtab == undefined || localStorage.option_pinnedtab == "true"}, function() {
                        window.close();
                        return;
                    });
                } else if (localStorage.option_alwaystab == "true") {
                    log("--> no tab, but alwaystab -> creating tab");                    
                    chrome.tabs.create({url:chrome.extension.getURL("/popup.html"), pinned: localStorage.option_pinnedtab == undefined || localStorage.option_pinnedtab == "true"}, function(tab) {
                        background.popouttab = tab;
                        window.close();
                    });
                } else
                    log("--> no tab, opening popup");

            }

            var signUpLink =  "<a href='https://simple-note.appspot.com/create/'>" + chrome.i18n.getMessage("signup") + "</a>";
            var optionsLink = "<a href='options.html'>" + chrome.i18n.getMessage("options_page") + "</a>";

            if ( !localStorage.option_email || !localStorage.option_password) {
                $("body").css("width", "400px");
                $("body").css("height", "550px");                
                displayStatusMessage(chrome.i18n.getMessage("welcometext", [signUpLink, optionsLink]));
                _gaq.push(['_trackEvent', 'popup', 'ready', 'displayWelcomeMessage']);
            } else {
                var directlyShowNote = localStorage.lastopennote_key != undefined && localStorage.lastopennote_key != "" && localStorage.lastopennote_open == "true" && localStorage.option_opentonote == "true";

                if (!isTab) {
                    if (!directlyShowNote) {
                        $("body").css("width","400px");
                        $("body").css("height", "550px");
                    } else {
                        $("body").css("width","800px");
                        $("body").css("height", "550px");
                    }
                }
                popupi18n();

                chrome.extension.sendRequest({action : "login"}, function(result) {
                    if (result.success) {
                        _gaq.push(['_trackEvent', 'popup', 'ready', 'login_success']);

                        snEditor = new SNEditor();
                        
                        log("(ready): requesting full sync.");
                        chrome.extension.sendRequest({action: "sync", fullsync:true}, function() {
                            log("(ready): sync request complete");
                            chrome.extension.onRequest.addListener(uiEventListener);
                        });

                        if (localStorage.lastopennote_key != undefined && localStorage.lastopennote_key != "" && localStorage.lastopennote_open == "true" && localStorage.option_opentonote == "true") {
                            log("(ready): sending request for open to note");
                            chrome.extension.sendRequest({action:"note",key:localStorage.lastopennote_key}, function(note) {
                                if (note)
                                    snEditor.setNote(note,{duration:0});
                            });
                        }

                        $("#note").hide();

                        fillTags(true);

                        // bind ADD button
                        $('div#index div#toolbar div#add').click(function() {
                            _gaq.push(['_trackEvent', 'popup', 'addclicked']);
                            snEditor.setNote();
                        });

                        // bind SYNC div
                        $("#sync").click( function() {
                            _gaq.push(['_trackEvent', 'popup', 'syncclicked']);
                            chrome.extension.sendRequest({action: "sync", fullsync:true});
                        })

                        $("div.noterow").live("mouseover", function(event) {
                            $("abbr.notetime",this).css("color","#ddd");
                            $("div.abstract",this).css("color","#ccc");
                            $("div.noteheading",this).css("color","#fff");
                        });

                        $("div.noterow").live("mouseleave", function(event) {
                            $("abbr.notetime",this).css("color","");
                            $("div.abstract",this).css("color","");
                            $("div.noteheading",this).css("color","");
                        });

                        // bind SEARCH field
                        var options = {
                            callback : function() {
                                log("typewatch: calling fillIndex");
                                fillIndex();
                            },
                            wait : 250,
                            highlight : false,
                            captureLength : -1 // needed for empty string ('') capture
                        };
                        $('div#index div#toolbar input#q').typeWatch(options);

                        $.timeago.settings.strings= {
                            prefixAgo: null,
                            prefixFromNow: null,
                            suffixAgo: "",
                            suffixFromNow: "from now",
                            seconds:    chrome.i18n.getMessage("seconds"),
                            minute:     chrome.i18n.getMessage("minute"),
                            minutes:    chrome.i18n.getMessage("minutes"),
                            hour:       chrome.i18n.getMessage("hour"),
                            hours:      chrome.i18n.getMessage("hours"),
                            day:        chrome.i18n.getMessage("day"),
                            days:       chrome.i18n.getMessage("days"),
                            month:      chrome.i18n.getMessage("month"),
                            months:     chrome.i18n.getMessage("months"),
                            year:       chrome.i18n.getMessage("year"),
                            years:      chrome.i18n.getMessage("years"),
                            numbers: []
                        }

                        if (localStorage.option_color_index)
                            $("body").css("background-color",localStorage.option_color_index);

                        //$("div#note").resizable();
                        if (isTab) {
                            //$("div#note").css("left","421px");
                            //$("#container").splitter();
                        
//                            $("div#slider").show();
//                            $("div#note").css("left","421px");
//
//                            $("div#note").resizable({handles: {"w": $("div#slider").get(0)},
//                                    resize: function(event, ui)
//                                    {
//                                        var left = ui.position.left;
//                                        $('div#index').css("width", (left-24)+"px");
//                                        $('div#slider').css("left", (left-22)+"px");
//                                    },
//                                    stop: function(event, ui)
//                                    {
//                                        var left = ui.position.left;
//                                        $('div#index').css("width", (left-24)+"px");
//                                        $('div#slider').css("left", (left-22)+"px");
//                                    }
//                            });
//                            console.log(cssprop("div#note","left"))
//                            console.log($("div#index").css("right"))
                            $("div#index").css("width",cssprop("div#note","left")-4)
                        } else {
                            $("div#slider").hide();
                        }

                    }
                    else {
                        _gaq.push(['_trackEvent', 'popup', 'ready', 'login_err']);
                        log("(ready): login error, message=" + result.message);
                        if (!result.message)
                            result.message = "Login for email '" + localStorage.option_email + "' failed, please check your Simplenote email address and password on the " + optionsLink + "!";
                        else
                            result.message += "<br><br>Alternatively you can try to correct your username and password on the " + optionsLink + "!";
                        displayStatusMessage(result.message);
                    }
                });
            }
        });
}

function popupi18n() {
    $("#q").attr("placeholder",chrome.i18n.getMessage("search_placeholder"));
    $("#q").attr("title",chrome.i18n.getMessage("search_tooltip","alt-q"));
    $("#notetags").attr("title",chrome.i18n.getMessage("tagselect_tooltip","alt-n"));
    $("#add").attr("title",chrome.i18n.getMessage("add_tooltip","alt-a"));    
    $("#sync").attr("title",chrome.i18n.getMessage("sync_tooltip"));
    $("#tags").attr("placeholder",chrome.i18n.getMessage("tag_placeholder"));
    $("#tags").attr("title",chrome.i18n.getMessage("tag_tooltip",["alt-t", "alt-e"]));
    $("#pintoggle").attr("title",chrome.i18n.getMessage("pin_tooltip","alt-p"));   
    $("#popout").attr("title",chrome.i18n.getMessage("popout_tooltip","alt-o"));
    $("#trash").attr("title",chrome.i18n.getMessage("trash_tooltip","ctrl-alt-d"));
    $("#wraptoggle").attr("title",chrome.i18n.getMessage("wordwrap_tooltip","alt-w"));
    $("#undo").attr("title",chrome.i18n.getMessage("revert_tooltip","alt-r"));    
    $("#print").attr("title",chrome.i18n.getMessage("print_tooltip"));    

    if (isTab)
        $('#backtoindex').attr("title",chrome.i18n.getMessage("close_tab_tooltip",["alt-b","alt-x"]));
    else
        $("#backtoindex").attr("title",chrome.i18n.getMessage("backtoindex_tooltip",["alt-b","alt-x"]));    
}
/*
 * Displays a status message.
 * @param message The HTML content of the status message to display. All links
 *     in the message are be adjusted to open in a new window and close the
 *     popup.
 */
function displayStatusMessage(message) {
    $('#toolbar').hide();
    $('#statusbar').hide();
    $('#note').hide();
    $('#notes').html(message);
    $('body').css("background","#fff");
    links = $('a');
    links.attr('target', '_blank');
    links.click(function() {window.close();});
}

/*
 * Fills the Tags dropdown with all tags from the DB.
 *
 * @param callFillIndex boolean, call fillIndex() after tags are filled or not
 */
function fillTags(callFillIndex) {
    log("fillTags");
    chrome.extension.sendRequest({action:"tags"}, function(taginfos) {
        // fill dropdown
        $("#notetags").unbind();
        var stillhavetag = false;
        var oldval = $("#notetags").val();
        $("#notetags").html("");
        var style;
        $.each(taginfos,function(i,taginfo) {
            style = taginfo.count > 0?"":'style="color:#aaa"';
            if (taginfo.tag == "#all#")
                $("#notetags").append('<option value="" ' + style +  '>' + chrome.i18n.getMessage("tags_all") + ' [' + taginfo.count + ']</option>');
            else if (taginfo.tag == "#notag#")
                $("#notetags").append('<option value="#notag#" ' + style +  '>' + chrome.i18n.getMessage("tags_untagged") + ' [' + taginfo.count + ']</option>');
            else if (taginfo.tag == "#trash#")
                $("#notetags").append('<option value="#trash#" ' + style +  '>' + chrome.i18n.getMessage("tags_deleted") + ' [' + taginfo.count + ']</option>');
            else
                $("#notetags").append('<option value="' + taginfo.tag + '" ' + style +  '>' + taginfo.tag + " [" + taginfo.count + "] </option>");

            if (oldval == taginfo.tag)
                stillhavetag = true;
        });
        if (!stillhavetag) {
            oldval = "#all#";
        }
       // add handler
        $("#notetags").val(oldval);
        $("#notetags").change(function(event) {
            log("#notetags:changed: calling fillIndex");
            fillIndex();
        });

        if (callFillIndex)
            fillIndex();
    });
}
/*
 * Fills the index pane with noterows.
 */
function fillIndex() {

    var req =               {action : "getnotes", deleted : 0};
    req     = mergeobj(req, {tag : $("#notetags").val()});
    req     = mergeobj(req, {contentquery : $('#q').val()});
    req     = mergeobj(req, {sort:localStorage.option_sortby, sortdirection:localStorage.option_sortbydirection});

    log("fillIndex:");
    log(req);

    chrome.extension.sendRequest(req, function(notes) {
        log("fillIndex:request complete");
        var note;

        $('div#index div#notes').empty();
        $('div#notes').unbind("scroll");

        if (notes.length > 0) {
            for(var i = 0; i < notes.length; i ++ ) {
                note = notes[i];
                indexAddNote("append",note);
                if (i<15 && note.content != undefined)
                    indexFillNote(note);
            }
            checkInView();
        } else
            $('div#index div#notes').html("<div id='nonotes'>" + chrome.i18n.getMessage("no_notes_to_show") + "</div>");

        $('div#notes').scrollTop(0);
        $('div#notes').scroll(checkInView);
        
        snEditor.hideIfNotInIndex();

    });

}
/*
 * Appends/prepends/replaces a noterow div in the index pane.
 *
 * @param mode "delteAndPrepend", "append", "replace"
 * @param note must at least be a note from and index api call
 */
function indexAddNote(mode, note){
    var date, prefix, shareds = [], html =  "";

    // assemble noterow html string
    if (mode!= "replace")
        html = "<div class='noterow' id='" + note.key  + "' >";

    // date abbr
    if (localStorage.option_showdate == "true") {
        if (localStorage.option_sortby == "createdate") {
            date = convertDate(note.createdate);
            prefix = chrome.i18n.getMessage("created");
        } else {
            date = convertDate(note.modifydate);
            prefix = chrome.i18n.getMessage("modified");;
        }

        html+=      "<abbr class='notetime' id='" + note.key + "time' title='" + ISODateString(date) + "'>" + prefix + localeDateString(date) + "</abbr>";
    }
    // pin/shared/published
    //if (note.deleted == 0) {
        html+=      "<div class='" + (note.systemtags.indexOf("pinned")>=0?"pinned":"unpinned") + "' id='" + note.key + "pin'>&nbsp;</div>";
        html+=      "<div title='" + chrome.i18n.getMessage("published_tooltip") + "' class='" + (note.publishkey != undefined?"published":"unpublished") + "' id='" + note.key + "published'>&nbsp;</div>";

        if (note.systemtags.indexOf("shared") >= 0) {


            $.each(note.tags, function (i,tag) {
                if (validateEmail(tag)) {
                    shareds.push(tag);
                }
            });
            if (shareds.length > 0)
                html+= "<div class='shared' id='" + note.key + "shared' title='" + chrome.i18n.getMessage("sharer_tooltip") + " " + shareds.join(", ") + "'>&nbsp;</div>";
            else
                html+= "<div class='shared' id='" + note.key + "shared' title='" + chrome.i18n.getMessage("sharee_tooltip") + "'>&nbsp;</div>";
        }
    //} else {

    //}
    // note heading div
    html+=          "<div class='noteheading' id='" + note.key + "heading'></div>";
    // note abstract div
    html+=          "<div class='abstract' id='" + note.key + "abstract'>&nbsp;<br>&nbsp;</div>";

    if (mode!="replace")
        html+="</div>";

    // insert the html string into document
    if (mode=="delteAndPrepend") {
        $('div.noterow#' + note.key).remove();
        $('#notes').prepend(html);
    } else if (mode=="append") {
        $('#notes').append(html);
    } else if (mode=="replace")
        $('div.noterow#' + note.key).html(html);

    // get ui elements into variables
    var $noterow = $('div.noterow#' + note.key);
    var $noteheading = $('div.noteheading#' + note.key + "heading");
    var $notetime = $("abbr.notetime#" + note.key + "time");
    var $notepin = $("div#" + note.key + "pin");

    if (localStorage.option_sortby == "createdate") {
        $noterow.attr("sortkey",note.createdate);
    } else if (localStorage.option_sortby == "modifydate") {
        $noterow.attr("sortkey",note.modifydate);
    } else
        $noterow.attr("sortkey",note.content?note.content.trim().substring(0,30).toLowerCase():"");
    
    $noterow.attr("pinned",note.systemtags.indexOf("pinned")>=0?"true":"false");
    $noterow.attr("shared",note.systemtags.indexOf("shared")>=0?"true":"false");

    // bind timeago for time abbr
    $notetime.unbind();
    if (localStorage.option_showdate == "true")
        $notetime.timeago();
    
    $noterow.attr('loaded',"false");

    // deleted note
    if (note.deleted == 1) {
        $noterow.attr("title", chrome.i18n.getMessage("click_to_undelete"));
        return;
    }

    $notepin.attr("title",chrome.i18n.getMessage("click_to_pinunpin"));

    // bind pinned klick
    $("#"+note.key+"pin").die();
    $("#"+note.key+"pin").live("click",{key: note.key, systemtags: note.systemtags},function(event) {
            var key = event.data.key;
            var systemtags = event.data.systemtags;

            event.stopPropagation();

            if ($(this).attr("class")=="pinned") {
                note.systemtags.splice(systemtags.indexOf("pinned"),1);
            } else {
                note.systemtags.push("pinned");
            }
            chrome.extension.sendRequest({action:"update", key:key, systemtags:systemtags});
        });
    // bind published click
    if (note.publishkey) {
        $("#"+note.key+"published").die();
        $("#"+note.key+"published").live("click",note.publishkey,function(event) {
            event.stopPropagation();
            openURLinTab("http://simp.ly/publish/"+event.data);
        });
    }

    // unread
    if (note.systemtags.indexOf("unread")>0)
         $noterow.addClass("unread");

    // tab selected
    if (isTab && snEditor.note && snEditor.note.key == note.key) {
        $noterow.addClass("selectednote");
    }

    // sync note
    if (note._syncNote)
        $noteheading.addClass("syncnote");
    else
        $noteheading.removeClass("syncnote");
}

/*
 *  Fills a noterow div from the note.content. Callback from checkInView.
 *
 *  @param elementOrNote jquery object div.noterow#key or note object with .content
 */
function indexFillNote(elementOrNote) {

    if (elementOrNote.key) {//note
        indexFillNoteReqComplete(elementOrNote);
    } else {
        var key = elementOrNote.attr("id");

        // reflowing triggers scrolls
        if (elementOrNote.attr("requested") == "true")
            return;

        $('#' + key + "heading").append('<img id="' +key + 'loader" src="images/loader_small.gif"/>');
        $('#' + key + "heading").attr("align","center");

        chrome.extension.sendRequest({action : "note", key :key}, indexFillNoteReqComplete);

        elementOrNote.attr("requested","true");
    }
}
/*
 *  Fills a noterow div from the note.content. Callback from checkInView.
 *
 *  @param note note with .content, .key and .deleted
 */
function indexFillNoteReqComplete(note) {

        var $noterow = $('#' + note.key);
        var $noteheading = $('#' + note.key + "heading");
        var $noteabstract = $('#' + note.key + "abstract");

        var lines = note.content.split("\n").filter(function(line) {
            return ( line.trim().length > 0 )
            });

        // heading
        $('#' + note.key + 'loader').remove();
        $noteheading.removeAttr("align"); // from loader
        // set actual heading
        $noteheading.html(htmlEncode(lines[0],100)); // dont need more than 100 chars
        // deleted note css style
        if (note.deleted == 1) {
            $noteheading.addClass("noteheadingdeleted"); // for text color
            $noterow.addClass("noterowdeleted"); // for undelete image on hover
        }

        // abstract
        var abstractlines;
        if (localStorage.option_abstractlines>=0)
            abstractlines = lines.slice(1,Math.min(lines.length,localStorage.option_abstractlines*1+1));
        else // -1 ~ all
            abstractlines = lines;
        // set actual abstract
        $noteabstract.html(htmlEncode(abstractlines,100).join("<br/>"));

        $noterow.unbind();
        // add dblclick binding
        //$noterow.css("height",$noterow.height());
        //$noterow.data('origheight',$noterow.height());
        //$noterow.dblclick(maximize);

        // add click binding
        if (note.deleted == 0) {
            $("div.noterow#"+note.key).die();
            $("div.noterow#"+note.key).live("click",note, function(event) {
                if (isTab && snEditor.note)
                    snEditor.saveCaretScroll();
                
                snEditor.setNote(event.data);
            });

            $("div.noterow#"+note.key).live("mousedown",note, function(event) {
                snEditor.setNote(event.data);
            });
        } else {
            $noterow.attr("title", chrome.i18n.getMessage("click_to_undelete"));
            $("div.noterow#"+note.key).die();
            $("div.noterow#"+note.key).live("click",note.key,function(event) {
                chrome.extension.sendRequest({action : "update", key : event.data, deleted : 0});
            });
        }

        // check new inview, might have changed due to reflow
        $noterow.attr('loaded',"true");

        checkInView();
}

// encode string or string array into html equivalent
function htmlEncode(s, maxchars)
{
    if (!s)
        return "";
    if (!maxchars)
        maxchars = 1000000;

    if (s instanceof Array)
        return s.map(function(s) {
            return htmlSafe(s.substring(0,maxchars)).replace(/\n/g,"<br>").replace(/\s/g,"&nbsp;");
        });
    else
        return htmlSafe(s.substring(0,maxchars)).replace(/\n/g,"<br>").replace(/\s/g,"&nbsp;");
}

// make string html safe
function htmlSafe(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

//  ---------------------------------------
function ISODateString(d) {
    return d.getUTCFullYear()+'-'+pad(d.getUTCMonth()+1)+'-'+ pad(d.getUTCDate())+'T'+ pad(d.getUTCHours())+':'+ pad(d.getUTCMinutes())+':'+ pad(d.getUTCSeconds())+'Z'
}
//  ---------------------------------------
function localeDateString(d) {
    var s = d.toLocaleString();
    return s.substring(0, s.indexOf("GMT")-1);
}
//  ---------------------------------------
function slideEditor(callback, duration) {
    log("slideEditor");
    if (duration == undefined)
        duration = slideDuration;
    $("#note").show();
    if (!isTab) {
        $('div#index').animate({left:"-400px"}, {duration: duration, complete: callback, easing: slideEasing});
        $('div#note').animate({left:"2px"}, {duration: duration, complete: function() {$("#index").hide();if (callback) callback();},easing: slideEasing});
        $('body').animate({width:"800px"}, {duration: duration, easing: slideEasing});
    } else
        if (callback) callback();
    currentView = "editor";
    snEditor.show();
}
//  ---------------------------------------
function slideIndex(callback, duration) {
    log("slideIndex");
    if (duration == undefined)
        duration = slideDuration;
    localStorage.lastopennote_open = "false";
    snEditor.clearDirty();
    $("#index").show();
    if (!isTab) {
        $('div#index').animate({left:"2px"}, {duration: duration, complete: callback, easing: slideEasing});
        $('div#note').animate({left:"400px"}, {duration:duration, complete: function() {$("#note").hide();}, easing: slideEasing});
        $('body').animate({width : "400px"}, {duration:duration, easing: slideEasing});
    }
    currentView = "index";
    snEditor.saveCaretScroll();
    delete snEditor.note;
}

//  ---------------------------------------
//  SNEditor
//  ---------------------------------------

function SNEditor() {
    log("SNEditor:create");
    this.codeMirror = new CodeMirror(document.getElementById("note"),{
                    parserfile: "parsesimple.js",
                    path: "javascripts/lib/codemirror1/",
                    iframeClass: "cm-iframe",
                    content: "",
                    stylesheet: "stylesheets/editor.css",
                    tabMode: "shift",
                    indentUnit: 4,
                    enterMode: "keep",
                    electricChars : false
                   // onChange: function() {if(isTab) that.saveNote();}
                });

    // set ids for important nodes
    $(".cm-iframe").attr("id","cmiframe");
    $(".CodeMirror-wrapping").attr("id","cmwrapper");

    $("#cmwrapper").css("position","");
    $("#cmwrapper").css("height","");
    $("#cmiframe").attr("tabindex","7");

    this.dirty={content: false, tags: false, pinned: false};    
}
//  ---------------------------------------
SNEditor.prototype.setFont = function() {
    log("CodeMirror.setFont")
    var $head = $(this.codeMirror.editor.container.ownerDocument.head);
    var $editbox = $(this.codeMirror.editor.container);
    // get fontinfo if there
    var fontinfo;
    if (localStorage.editorfontinfo)
        fontinfo = JSON.parse(localStorage.editorfontinfo);

    // inject font url
    // keeping this so we can easily delete already loaded fonts
    // otherwise could add a fontinfo field for url
    var fontname = localStorage.option_editorfont?localStorage.option_editorfont:fontinfo.family;
    for(var name in fontUrls) {
        if (fontname == name) {
            $head.append(fontUrls[name]);
            delete fontUrls[name];
            break;
        }
    }
    // set font properties
    if (fontinfo) {
        $editbox.css("font-family",fontinfo.family);
        $editbox.css("font-size",fontinfo.size);
        $editbox.css("letter-spacing",fontinfo.letter_spacing);
        $editbox.css("word-spacing",fontinfo.word_spacing);
        $editbox.css("line-height",fontinfo.line_height);
    } else {
        $editbox.css("font-family", localStorage.option_editorfont);
        $editbox.css("font-size", localStorage.option_editorfontsize);
    }

    // set font shadow
    if (localStorage.option_editorfontshadow && localStorage.option_editorfontshadow == "true")
        $editbox.css("text-shadow","1px 1px 1px #ccc" );

    // set colors
    if (localStorage.option_color_editor)
        $editbox.css("background-color",localStorage.option_color_editor);
    if (localStorage.option_color_editor)
        $editbox.css("color",localStorage.option_color_editor_font);
}
//  ---------------------------------------
SNEditor.prototype.getTags = function() {
    log("CodeMirror.getTags")
    var tags = $("div#note input#tags").val().trim().split(" ").map(function(e) {return e.trim();});
    return tags;
}

//  ---------------------------------------
SNEditor.prototype.initialize = function() {

    if (this.initialized)
        return;

    log("CodeMirror.intitalize");

    var $editbox = $(this.codeMirror.editor.container);
    var that = this;


    // add note content change (dirty) event listeners
    
    $editbox.unbind();
    $editbox.bind('change keyup paste cut', function(event) {
        that.setDirty("content", that.note.content != that.codeMirror.getCode(), event);        
    });

    this.typeWatchInit($editbox);

    // fix for home not scrolling all to the left
    $editbox.keydown(shorcuts);
    $editbox.bind("keydown keyup",function(event) {
        //alert(event.keyCode)        
        switch(event.keyCode) {
            case 36: //home key
                $editbox.scrollLeft(Math.max(0,$editbox.scrollLeft()-300));
                if (event.ctrlKey)
                    $editbox.scrollTop(Math.max(0,$editbox.scrollTop()-30));
                break;
            case 35: //end key
                if (event.ctrlKey) {
                    $editbox.scrollTop($editbox.scrollTop() + 20);
                    $editbox.scrollLeft(Math.max(0,$editbox.scrollLeft()-300));
                }
                break;
            case 37: //left key
                pos = that.codeMirror.cursorPosition(true);
                if (pos.character == 0)
                    $editbox.scrollLeft(0);
                break;
            case 38: //up key
                line = that.codeMirror.lineNumber(that.codeMirror.cursorLine());
                if (line == 1)
                    $editbox.scrollTop(0);
                break;
            case 40: //down key
                if (that.codeMirror.lastLine() == that.codeMirror.cursorLine())
                    $editbox.scrollTop($editbox.scrollTop() + 20);
                break;
        }
    });

    // add note tags change (dirty) event listeners
    $('div#note input#tags').unbind();
    $('div#note input#tags').bind('change keyup paste cut', function(event) {
        that.setDirty("tags", !arrayEqual(that.note.tags,that.getTags()), event);
    });

    // add note pinned (dirty) event listener
    $('div#note #pintoggle').unbind();
    $('div#note #pintoggle').bind('click', function(event) {
        
        _gaq.push(['_trackEvent', 'popup', 'pintoggled']);

        snEditor.setPintoggle(!snEditor.isPintoggle());
        
        var changed = that.setDirty("pinned", (that.note.systemtags.indexOf("pinned")>=0) != snEditor.isPintoggle() , event);
       
        if (changed && isTab)
            that.saveNote();

        that.focus();
    });

    // bind back button
    $('div#note #backtoindex').unbind();
    $('div#note #backtoindex').click(function(event) {
        if (that.isNoteDirty())
            that.saveNote();

        slideIndex();
    });

    // bind word wrap
    $("div#note #wraptoggle").unbind();
    $("div#note #wraptoggle").bind('click', function(event) {

        _gaq.push(['_trackEvent', 'popup', 'wordwraptoggled']);

        snEditor.setWraptoggle(!snEditor.isWraptoggle());

        localStorage.wordwrap = snEditor.isWraptoggle();
        that.codeMirror.setTextWrapping(snEditor.isWraptoggle());
        that.focus();
    });
    snEditor.setWraptoggle(localStorage.wordwrap != undefined && localStorage.wordwrap == "true");
    this.codeMirror.setTextWrapping(snEditor.isWraptoggle());


    // bind UNDO button
    $('div#note #undo').unbind();
    $('div#note #undo').click(function(event) {
        // reset content
        log("CodeMirror.initialize:undo clicked");

        _gaq.push(['_trackEvent', 'popup', 'undoclicked']);

        var note = that.note;
        if (that.dirty.content) {
            that.saveCaretScroll();
            that.codeMirror.setCode(note.content);
            that.restoreCaretScroll();
        }
        // reset tags
        if (that.dirty.tags)
            $('div#note input#tags').val(note.tags.join(" "));
        // reset pinned
        if (that.dirty.pinned) {
            snEditor.setPintoggle(note.systemtags.indexOf("pinned")>=0);
        }

        $('div#note #undo').hide();

        snEditor.clearDirty(); // should not dont need this here b/c of callbacks
        that.focus();
    });
    $('div#note #undo').hide();

    // bind DELETE/CANCEL
    $('#trash').unbind();
    $('#trash').click(function() {
        _gaq.push(['_trackEvent', 'popup', 'trashclicked']);
        that.trashNote();
        slideIndex();
    });

    // bind PRINT
    if (isTab) {
        $('div#note #print').unbind();
        $('div#note #print').click(function() {
            _gaq.push(['_trackEvent', 'popup', 'printclicked']);
            that.print();
        });
    } else
        $('div#note #print').hide();


    // bind link clicks
    $(".sn-link",$editbox).die();
    $(".sn-link",$editbox).live("click",function(event) {
       if (event.ctrlKey) {
           _gaq.push(['_trackEvent', 'popup', 'linkclicked_unhot']);
           return;
       }
       _gaq.push(['_trackEvent', 'popup', 'linkclicked']);
       var url = this.textContent.trim();
       openURLinTab(url);
    });
    // bind ctrl link disable
    $editbox.bind('keydown', function(event) {
        if (event.keyCode == 17) // ctrl
            $(".sn-link",$editbox).addClass("sn-link-unhot");
    });
    // bind ctrl link disable disable
    $editbox.bind('keyup', function(event) {
        if (event.keyCode == 17) // ctrl
            $(".sn-link",$editbox).removeClass("sn-link-unhot");
    });

    if (!isTab)
        $('div#note #popout').click(function(event) {
            _gaq.push(['_trackEvent', 'popup', 'popoutclicked']);
            chrome.tabs.create({url:chrome.extension.getURL("/popup.html"), pinned:localStorage.option_pinnedtab == undefined || localStorage.option_pinnedtab == "true"}, function(tab) {
                background.popouttab = tab;
            });
        });
    else {
        $('div#note #popout').hide();
        $('div#note #undo').hide();        
        $('div#note #backtoindex').unbind();
        $('div#note #backtoindex').click(function(event) {
            window.close();
        });

        // bind typewatch TAGS field
        var options = {
            callback : function() {
                log("typewatch: tags changed");
                that.saveNote();
            },
            wait : editorSaveTime,
            highlight : false,
            captureLength : -1 // needed for empty string ('') capture
        };
        $('div#note input#tags').typeWatch(options);
    }
    // add context menu
    this.makeContextMenu();

    this.initialized = true;
}

//  ---------------------------------------
SNEditor.prototype.saveCaretScroll = function() {
    log("CodeMirror.saveCaretScroll");
    if (localStorage.option_remembercaret != undefined && localStorage.option_remembercaret == "false" || !this.note)
        return;

    var caretScroll = this.codeMirror.cursorPosition();
    caretScroll.line = this.codeMirror.lineNumber(caretScroll.line);
    caretScroll.scrollTop = $(this.codeMirror.editor.container).scrollTop();
    caretScroll.scrollLeft = $(this.codeMirror.editor.container).scrollLeft();
    localStorage[this.note.key + "_caret"] = JSON.stringify(caretScroll);
    log("caretScroll:" + caretScroll.line + ":" + caretScroll.character + " [" + caretScroll.scrollTop + "/" + caretScroll.scrollLeft + "]");
}

//  ---------------------------------------
SNEditor.prototype.restoreCaretScroll = function () {
    log("CodeMirror.restoreCaretScroll")

    if (this.note && localStorage[this.note.key + "_caret"] && (localStorage.option_remembercaret == undefined || localStorage.option_remembercaret == "true")) {
        var caretScroll = JSON.parse(localStorage[this.note.key + "_caret"]);

        var lineH;
        if (caretScroll.line == "lastline")
            lineH = this.codeMirror.lastLine();
        else
            lineH = this.codeMirror.nthLine(caretScroll.line);

        var character = Math.min(this.codeMirror.lineContent(lineH).length,caretScroll.character);
        this.codeMirror.selectLines(lineH, character);

        if (caretScroll.scrollTop)
            $(this.codeMirror.editor.container).scrollTop(caretScroll.scrollTop);
        if (caretScroll.scrollLeft)
            $(this.codeMirror.editor.container).scrollLeft(caretScroll.scrollLeft);
        log("caretScroll:" + caretScroll.line + ":" + caretScroll.character + " [" + caretScroll.scrollTop + "/" + caretScroll.scrollLeft + "]");
    }
}

//  ---------------------------------------
SNEditor.prototype.insertUrl = function() {
    log("CodeMirror.insertUrl")
    _gaq.push(['_trackEvent', 'popup', 'insertUrl']);

    var that = this;
    chrome.tabs.getSelected(undefined,function(tab) {
        that.codeMirror.replaceSelection(tab.url);
        $(that.codeMirror.editor.container).change();
    });
}

//  ---------------------------------------
SNEditor.prototype.searchForSelection = function () {
    log("CodeMirror.searchForSelection")
    _gaq.push(['_trackEvent', 'popup', 'searchForSelection']);

    openURLinTab("http://google.com/search?q=" + encodeURIComponent(this.codeMirror.selection().trim()));
}

//  ---------------------------------------
SNEditor.prototype.hideIfNotInIndex = function () {
    if (!isTab)
        return;

    log("CodeMirror.hideIfNotInIndex")

    var keys = $("div#index div.noterow").map(function(i,e) {return this.id;}).get();
    var that = this;

    if (!this.note || (this.note.key != "" && keys.indexOf(this.note.key)<0)) {
        if (keys.length > 0)
            chrome.extension.sendRequest({action:"note", key:keys[0]}, function(note) {
                if (note.deleted != 1)
                    that.setNote(note,{focus:false});
                else
                    $("div#note").hide();
                });
        else
            $("div#note").hide();
    } else if (this.note)
        this.show();
}

//  ---------------------------------------
SNEditor.prototype.show = function() {
    $("div#note").show();
}

SNEditor.prototype.focus = function() {
    $(this.codeMirror.editor.container).focus();
}

//  ---------------------------------------
SNEditor.prototype.makeContextMenu = function() {

    log("CodeMirror.makeContextMenu")

    var $editbox = $(this.codeMirror.editor.container);
    var that = this;
    var menu1 = [
      {'Insert browser URL (alt-v)':
        {
              onclick: function() {that.insertUrl();},
              disabled: isTab
        }
      },

      {'Search for selection (alt-s)':
        {
            onclick: function() {that.searchForSelection();},
            className: "disableonnoselection"
        }
      }
      //,$.contextMenu.separator
    ];

    $editbox.contextMenu(menu1,{
        theme:'gloss',
        offsetX:isTab?200:0,
        offsetY:20,
        direction:'down',
        beforeShow: function() {
            if (that.codeMirror.selection().trim() == "")
                $(this.menu).find('.disableonnoselection').each(function() {
                        $(this).toggleClass("context-menu-item-disabled", true);
                 });
            else
                $(this.menu).find('.disableonnoselection').each(function() {
                        $(this).toggleClass("context-menu-item-disabled", false);
                 });

            return true;
        },
    });
}

//  ---------------------------------------
SNEditor.prototype.setNote = function(note, options) {

    // new note dummy data
    if (note==undefined)
        note = {content:"",tags:[],systemtags:[], key:""};

    if (!options)
        options = {focus:true};

    log("CodeMirror.setNote: " + note.key);

    var that = this;
    if (this.isNoteDirty()) {
        this.saveNote(function() {
            that.setNote(note, options);
        });
        return;
    }

    this.note = note;
    this.setFont();
    this.initialize();

    // get note contents
    if (note.key == "") { // new note

        $("#trash").hide();
        $('div#note #undo').hide();
        $('div#note #popout').hide();

    } else { // existing note
        
        $("#trash").show();

        if (!isTab) {            
            $('div#note #popout').show();
        }

        localStorage.lastopennote_key = note.key;
        localStorage.lastopennote_open = "true";
        this.needCMRefresh("lastopen");
    }

    // set content
    this.codeMirror.setCode(note.content);
    // set tags
    $('div#note input#tags').val(this.note.tags.join(" "));
    // set pinned
    this.setPintoggle(this.note.systemtags.indexOf("pinned")>=0);

    this.clearDirty();

    slideEditor(function () {        
        that.restoreCaretScroll();
        if (note.systemtags.indexOf("unread")>0) {

            note.systemtags.splice(note.systemtags.indexOf("unread"),1);
            chrome.extension.sendRequest({action:"update", key:note.key, systemtags:note.systemtags}, function() {
                $("#" + note.key).removeClass("unread");
            });
        }
        that.focus();
    }, options.duration);

    if (isTab) {
        $("div.noterow").removeClass("selectednote");
        if (note.key && note.key != "") {
            $("div.noterow#"+ note.key).addClass("selectednote");
            chrome.extension.sendRequest({action:"cm_updatelastopen"});
        }
    }
}

//  ---------------------------------------
SNEditor.prototype.saveNote = function(callback) {
    if(!this.isNoteDirty())
        return;

    log("CodeMirror.saveNote");

    var key = this.note.key;

    var noteData = {};
    if (this.dirty.content)
        noteData.content = this.codeMirror.getCode();
    if (this.dirty.pinned) {
        snEditor.needCMRefresh("pinned");
        noteData.systemtags = this.note.systemtags;
        if (!this.isPintoggle()) {
            noteData.systemtags.splice(noteData.systemtags.indexOf("pinned"),1);
        } else {
            noteData.systemtags.push("pinned");
        }
    }
    if (this.dirty.tags)
        noteData.tags = this.getTags();
//    if ($('div#note input#encrypted').attr("dirty")=="true")
//        noteData.encrypted = $('div#note input#encrypted')?1:0;

    if (noteData.content == '' && key !='')     // existing note emptied -> trash
        this.trashNote();
    else if (key != '' ) {                  // existing note, new data -> update
        noteData.key = key;
        noteData.action = "update";
    } else if (noteData.content && noteData.content != '')          // new note, new data -> create
        noteData.action = "create";

    var that = this;

    if (noteData.action) {
        chrome.extension.sendRequest(noteData, function(note) {
            that.note = note;
            that.clearDirty();
            log("CodeMirror.saveNote: request complete");
            if (callback && typeof callback == "function")
                callback();
        });
    }

}
//  ---------------------------------------
SNEditor.prototype.isNoteDirty = function() {
    return this.dirty.content || this.dirty.pinned || this.dirty.tags;// || $('div#note input#encrypted').attr("dirty")=="true";
}
//  ---------------------------------------
SNEditor.prototype.clearDirty = function() {
    log("SNEditor.clearDirty");
    this.setDirty("content",false);
    this.setDirty("pinned",false);
    this.setDirty("tags",false);
    //$('div#note input#encrypted').removeAttr('dirty');
}
//  ---------------------------------------
SNEditor.prototype.setDirty = function(what, how, event) {
    if (!what)
        throw "what is dirty?";

    if (how == undefined)
        throw "how dirty is it?";

    if (event == undefined)
        event = {type : "unknown"};

    var oldDirty = this.dirty[what];

    if (oldDirty == how)
        return false;

    this.dirty[what] = how;

    if (how)
        log(what + " dirty now (" + event.type + ")");
    else
        log(what + " not dirty now (" + event.type + ")");

    if (this.isNoteDirty())
        $('div#note #undo').show();
    else
        $('div#note #undo').hide();

    return true;
}

SNEditor.prototype.needCMRefresh = function(type) {
    switch(type) {
        case "pinned":
            background.needCMRefresh = true;
            break;
        case "lastopen":
            background.needLastOpenRefresh = true;
            break;
        default:
            throw "SNEditor.needCMRefresh: unknown type " + type;
    }

    if (isTab)
        background.checkRefreshs();
}

//  ---------------------------------------
SNEditor.prototype.trashNote = function() {
    if (!this.note || this.note.key == "")
        return;
    var that = this;
    log("SNEditor.trashNote");
    $('div#note input').attr('disabled', 'disabled');
    chrome.extension.sendRequest({action : "update", key : this.note.key, deleted : 1},
            function() {
                $('div#note input').removeAttr('disabled');

                that.hideIfNotInIndex();
            });
}

SNEditor.prototype.typeWatchInit = function($editorelm) {

    if (!isTab)
        return;

    var that = this;

    function checkElement(timer) {
            var elTxt = that.codeMirror.getCode();

            // Fire if text > options.captureLength AND text != saved txt OR if override AND text > options.captureLength
            if (elTxt != timer.text)  {
                    timer.text = elTxt;
                    that.saveNote();
            }
    };
		
    function watchElement($elm) {
            // Allocate timer element
            var timer = {
                    timer : null,
                    text : that.codeMirror.getCode(),
                    wait : editorSaveTime
            };

            // Key watcher / clear and reset the timer
            var startWatch = function(evt) {
                    var timerWait = timer.wait;

                    var timerCallbackFx = function()
                    {
                            checkElement(timer)
                    }

                    // Clear timer
                    clearTimeout(timer.timer);
                    timer.timer = setTimeout(timerCallbackFx, timerWait);

            };

            $elm.keydown(startWatch);
            
    };

    watchElement($editorelm);

}

SNEditor.prototype.setPintoggle = function(to) {
    if (to) {
        $('div#note #pintoggle').addClass("pinned");
        $('div#note #pintoggle').removeClass("unpinned");
    } else {
        $('div#note #pintoggle').addClass("unpinned");
        $('div#note #pintoggle').removeClass("pinned");
    }
}

SNEditor.prototype.isPintoggle = function() {
    return $('div#note #pintoggle').hasClass("pinned");
}

SNEditor.prototype.setWraptoggle = function(to) {
    if (to) {
        $('div#note #wraptoggle').addClass("wrap_on");
        $('div#note #wraptoggle').removeClass("wrap_off");
    } else {
        $('div#note #wraptoggle').addClass("wrap_off");
        $('div#note #wraptoggle').removeClass("wrap_on");
    }
}

SNEditor.prototype.isWraptoggle = function() {
    return $('div#note #wraptoggle').hasClass("wrap_on");
}

SNEditor.prototype.print = function() {
    this.codeMirror.win.print();
}

//  ---------------------------------------
// from inview.js
function getViewportSize() {
    var mode, domObject, size = {
        height: window.innerHeight,
        width: window.innerWidth
    };

    // if this is correct then return it. iPad has compat Mode, so will
    // go into check clientHeight/clientWidth (which has the wrong value).
    if (!size.height) {
        mode = document.compatMode;
        if (mode || !$.support.boxModel) { // IE, Gecko
            domObject = mode === 'CSS1Compat' ?
            document.documentElement : // Standards
            document.body; // Quirks
            size = {
                height: domObject.clientHeight,
                width:  domObject.clientWidth
            };
        }
    }

    return size;
}
//  ---------------------------------------
// from inview.js
function getViewportOffset() {
    return {
        top:  window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop,
        left: window.pageXOffset || document.documentElement.scrollLeft || document.body.scrollLeft
    };
}

//  ---------------------------------------
// from inview.js
function checkInView() {
    var elements = $('div.noterow').get(), elementsLength, i = 0, viewportSize, viewportOffset;
    var allLoaded = true;
    elements = elements.filter(function (e) {
        return $(e).attr('loaded') != "true";
    });
    elementsLength = elements.length;

    if (elementsLength) {
        viewportSize   = getViewportSize();
        viewportOffset = getViewportOffset();

        //log("checkInView:viewportSize=[" + viewportSize.height + "," + viewportSize.width + "], viewportOffset=[" + viewportOffset.left + "," + viewportOffset.top + "]");
        // fix a bug on first load, size not initialized
        if (viewportSize.height == 0 && viewportSize.width == 0) {
            viewportSize.height = 502;viewportSize.width = 400;
        }

        for (; i<elementsLength; i++) {

            var $element      = $(elements[i]),
            elementSize   = {
                height: $element.height(),
                width: $element.width()
            },
            elementOffset = $element.offset(),
            loaded        = $element.attr('loaded') == "true",
            inview        = false;

            //log("checkInView:elementSize=[" + elementSize.height + "," + elementSize.width + "], elementOffset=[" + elementOffset.left + "," + elementOffset.top + "]");

            inview = elementOffset.top <= viewportOffset.top + viewportSize.height*(1 + preLoadFactor) &&
                elementOffset.left + elementSize.width >= viewportOffset.left &&
                elementOffset.left <= viewportOffset.left + viewportSize.width;

//            console.log(i + ": loaded " + loaded + ", inview=" + inview);
//            console.log(elementOffset);
//            console.log(elementOffset);

            allLoaded = allLoaded && loaded;
            if (!loaded && inview) {
                indexFillNote($element);
            }
        }
    }
}

function isInView($noterow) {
    $notes = $("#notes");
    viewportSize   = {height: $notes.height(), width:$notes.width()};
    viewportOffset = {top: $notes.scrollTop(), left:$notes.scrollLeft()};
    
    elementSize   = {
        height: $noterow.height(),
        width: $noterow.width()
    },
    elementOffset = $noterow.offset();

    //log("checkInView:elementSize=[" + elementSize.height + "," + elementSize.width + "], elementOffset=[" + elementOffset.left + "," + elementOffset.top + "]");

    return elementOffset.top <= viewportOffset.top + viewportSize.height*(1 + preLoadFactor) &&
        elementOffset.left + elementSize.width >= viewportOffset.left &&
        elementOffset.left <= viewportOffset.left + viewportSize.width;

//            console.log(i + ": loaded " + loaded + ", inview=" + inview);
//            console.log(elementOffset);
//            console.log(elementOffset);

}
