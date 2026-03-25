import platform
import os
import traceback

from dotenv import load_dotenv
from datetime import datetime
from pathlib import Path
from random import uniform

from selenium.webdriver.common.keys import Keys
from selenium import webdriver
from selenium.webdriver.chromium.options import ChromiumOptions
from selenium.webdriver.firefox.options import Options
from selenium.webdriver.firefox.firefox_profile import FirefoxProfile
from selenium.webdriver.common.by import By
from selenium.webdriver.remote.webelement import WebElement
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import NoSuchElementException, TimeoutException
from time import sleep, time
from telebot import TeleBot

from app.utils.multilogin import MultiloginAPI, MultiloginException
from app.utils.captcha import CaptchaSolver, CaptchaSolverWrongKeyException, CaptchaSolverZeroBalanceException, CaptchaSolverTimeoutException
from app.utils import get_random_string, is_date_in_range
from app.utils.config_loader import ConfigLoader
from app.utils.loger import logger
from app.utils.proxy_manager import ProxyManeger
from app.utils.tasks_api import TasksApi
from .exceptions import ImpervaIPBlocked, CaptchaAttemptsLimit, SearchLimit, AuthorizationFailed, TaskMissedException, TaskPingUnknownAnswer, TestCanceled, PleaseStandByException


class App():    
    def __init__(self, license:str, ref_num:str, dates_range:list, test_centers:list, task_id:int, thread_id:int, tasks_api:TasksApi, test_centers_codes:list) -> None:
        self.thread_id = thread_id
        self.test_centers = test_centers
        self.test_centers_codes = test_centers_codes
        self.dates_range = dates_range
        self.license = license
        self.ref_num = ref_num
        self.task_id = task_id
        self.tasks_api = tasks_api
        self.loger = logger.bind(thread_id=self.thread_id)
        self.loger.info(f"License {self.license}")
        self.search_counter = 0
        self.multilogin_email = None
        self.multilogin_password = None
        self.captcha_key = None
        self.driver = None
        self.profile_folder = None
        self.profile_id = None
        
        Path("errors").mkdir(exist_ok=True)
        self.get_env()
        self.telegram_bot = TeleBot(self.bot_token)
        self.config = ConfigLoader().get_config()
        self.proxy_manager = ProxyManeger(self.config["max_threads"])
        self.multilogin_api = MultiloginAPI(self.multilogin_email, self.multilogin_password)
        self.captcha_solver = CaptchaSolver(self.captcha_key)
    
    def get_env(self) -> None:
        load_dotenv()
        self.multilogin_email = os.getenv("MULTILOGIN_EMAIL")
        self.multilogin_password = os.getenv("MULTILOGIN_PASSWORD")
        self.captcha_key = os.getenv("CAPTCHA_KEY")
        self.bot_token = os.getenv("TG_BOT_TOKEN")
        
    def run(self) -> None:
        self.start_browser()
        while True:
            try:
                self.start_script()
                break
            except (AuthorizationFailed, TestCanceled, CaptchaSolverWrongKeyException, CaptchaSolverZeroBalanceException)  as e:
                self.loger.warning(e.__class__.__name__)
                self.save_error_data(e)
                self.stop_browser()
                raise
            except ImpervaIPBlocked as e:
                if self.config["change_profile_on_ban"]:
                    self.loger.info("Ip block, changing profile")
                    self.stop_browser()
                    sleep(2)
                    self.multilogin_api.remove_profile(self.profile_id, True)
                    sleep(3)
                    self.start_browser()
                else:
                    self.loger.info("Ip block, changing proxy")
                    sleep(1)
                    self.stop_browser()
                    sleep(3)
                    proxy = self.proxy_manager.get_proxy(self.thread_id)
                    self.multilogin_api.update_profile_proxy(self.profile_id, proxy)
                    sleep(1)
                    self.start_browser()
            except (CaptchaSolverTimeoutException, PleaseStandByException) as e:
                self.stop_browser()
                sleep(2)
                self.multilogin_api.remove_profile(self.profile_id, True)
                self.loger.warning(e.__class__.__name__)
                raise
            except Exception as e:
                self.loger.warning(e.__class__.__name__)
                self.loger.warning(e)
                self.save_error_data(e)
                self.stop_browser()
                self.loger.info(f"Total tries {self.search_counter}" )
                raise
    
    def start_browser(self) -> None:
        sleep(1)
        self.loger.info("Search profile")
        result = self.multilogin_api.search_profile(self.license)
        if "data" not in result or "profiles" not in result["data"]:
            self.loger.info(result)
            raise MultiloginException("Unknown answer")
        profiles = [] if result["data"]["profiles"] is None else result["data"]["profiles"]
        profiles = filter(lambda x: x["browser_type"] == self.config["browser_type"], profiles)
        profiles = list(profiles)
        if len(profiles) == 0:
            self.loger.info("Profile not exists, creating ...")
            proxy = self.proxy_manager.get_proxy(self.thread_id)
            result = self.multilogin_api.create_profile(self.license, proxy, self.config["browser_type"])
            self.loger.info(result)
            self.profile_id = result["data"]["ids"][0]
            self.profile_folder=None
        else:
            self.loger.info("Profile found")
            self.profile_id = profiles[0]["id"]
            self.profile_folder = profiles[0]["folder_id"]
            # self.profile_id = result["data"]["profiles"][0]["id"]
            # self.profile_folder = result["data"]["profiles"][0]["folder_id"]
        
        self.loger.info("Starting profile")
        while True:
            result = self.multilogin_api.start_profile(self.profile_id, self.profile_folder)
            self.loger.info(result)
            if result["status"]["error_code"] == "GET_PROXY_CONNECTION_IP_ERROR":
                proxy = self.proxy_manager.get_proxy(self.thread_id)
                self.multilogin_api.update_profile_proxy(self.profile_id, proxy)
                sleep(2)
                continue
            elif result["status"]["error_code"] == "CORE_DOWNLOADING_STARTED" or result["status"]["error_code"] == "CORE_DOWNLOADING_ALREADY_STARTED":
                sleep(2)
                continue
            elif result["status"]["error_code"] == "PROFILE_ALREADY_RUNNING":
                self.ping()
                # self.stop_browser()
                sleep(1)
                continue
            elif result["status"]["error_code"] != "":
                raise MultiloginException(result["status"]["error_code"])
            break
            
        selenium_port = result["data"]["port"]
        if self.config["browser_type"] == "mimic":
            options = ChromiumOptions()
        else:
            options = Options()
        
        self.driver = webdriver.Remote(
            command_executor=f"http://127.0.0.1:{selenium_port}", options=options
        )
        # self.driver.minimize_window()
        self.driver.set_page_load_timeout(60)

    def stop_browser(self) -> None:
        try:
            self.driver.quit()
        except: pass
        res = self.multilogin_api.stopProfile(self.profile_id)
    
    def save_error_data(self, error) -> None:
        timestamp = int(datetime.now().timestamp())
        filename = f"{timestamp}_{self.thread_id}"
        
        trace = traceback.format_exc()
        with open(f"./errors/{filename}.txt", "w+") as file:
            file.write(trace)

        try:
            content = self.driver.find_element( By.TAG_NAME, "html").get_attribute("innerHTML")
            with open(f"./errors/{filename}.html", "w+") as file:
                file.write(content)
        except: pass
        
        try:
            self.driver.save_screenshot(f"./errors/{filename}.png")
        except: pass
        
    def start_script(self) -> None:
        self.tasks_api.ping(self.task_id)
        self.load_main()
        self.find_slot_script()
        self.telegram_bot.send_message(95709596, "Slot found")
        sleep(60000)
    
    def find_slot_script(self):
        self.custom_click( (By.XPATH, '//a[@id="test-centre-change"]') )
        test_center_index = -1
        while True:
            self.ping()
            counter = self.search_counter + 1
            self.loger.info(f"Try #{counter}")
            sleep(self.config["pause_search"])
            test_center_index = 0 if test_center_index+1 >= len(self.test_centers) else test_center_index + 1
            test_center_name = self.test_centers[test_center_index]
            self.loger.info(f"Test center code {self.test_centers_codes[self.test_centers]}")
            self.loger.info(f"Test center {test_center_name}")

            self.wait_with_captcha( [ EC.visibility_of_element_located( (By.XPATH, '//input[@id="test-centres-input"]') ) ] )

            self.clear_input( (By.XPATH, '//input[@id="test-centres-input"]') )
            self.custom_type( (By.XPATH, '//input[@id="test-centres-input"]'), test_center_name )
            self.custom_click( (By.XPATH, '//input[@id="test-centres-submit"]') )
        
            self.wait_with_captcha( [ EC.visibility_of_element_located( (By.XPATH, '//a[contains(@id, "centre-name")]') ) ] )
            
            self.custom_click( (By.XPATH, '//a[contains(@id, "centre-name")]') )

            element = self.wait_with_captcha( [
                EC.visibility_of_element_located( (By.XPATH, '//a[@id="why-no-slots-help-link"]') ),
                EC.visibility_of_element_located( (By.XPATH, '//td[ contains(@class, "BookingCalendar-date--bookable")]//a') ),
                EC.visibility_of_element_located( (By.XPATH, '//h1[text() = "Search limit reached"]' ) )
            ])
            
            self.search_counter += 1
            
            if element.text == "Search limit reached":
                raise SearchLimit("Search limit")
            
            element_id = element.get_attribute("id")
            
            if element_id is not None and element_id == "why-no-slots-help-link":
                self.custom_click( (By.XPATH,  '//a[@id="change-test-centre"]') )
                continue
            else:
                slot_elements = self.driver.find_elements(By.XPATH, '//td[contains(@class, "BookingCalendar-date--bookable") and not(contains(@class, "is-active"))]//a')
                available_dates = [el.get_attribute("data-date") for el in slot_elements]
                self.loger.info("Available dates")
                self.loger.info(available_dates)
                
                good_dates = filter(lambda date: is_date_in_range(self.dates_range, date) ,available_dates)
                good_dates = list(good_dates)
                self.loger.info("Good dates")
                self.loger.info(good_dates)
                
                if len(good_dates):
                    res = self.book_slot(good_dates[0])
                    if res:
                        break
                sleep(2)
                self.driver.implicitly_wait(0)
                if len(self.driver.find_elements(By.XPATH, '//a[@id="warning-ok"]') ):
                    self.custom_click( (By.XPATH, '//a[@id="warning-ok"]'))
                # self.driver.implicitly_wait(30)

                self.custom_click( (By.XPATH,  '//a[@id="change-test-centre"]') )

    def book_slot(self, slot_date: str) -> bool:
        self.loger.info("Slot found")
        ### click day slot
        # a[data-date="{slot_date}"]
        self.custom_click( (By.XPATH, f'//a[@data-date="{slot_date}"]') , True)

        ### click firt available time
        # input[@class="SlotPicker-slot"]
        self.custom_click( (By.XPATH, '//input[@class="SlotPicker-slot"]/..') )
        
        ### click submit
        # input[@id="slot-chosen-submit"]
        self.custom_click( (By.XPATH, '//input[@id="slot-chosen-submit"]') )
        self.custom_click( (By.XPATH, '//button[@id="slot-warning-continue"]') )
        return True # False if slot not booked
        
    def load_main(self) -> None:
        resolution = self.driver.execute_script('''
            return {
                x_plan : window.screen.availWidth,
                y_plan : window.screen.availHeight,
                x_fact: window.innerWidth,
                y_fact: window.innerHeight
            }
        ''')
        print(resolution)
        # self.driver.set_window_size(resolution["x_plan"], resolution["y_plan"])
        sleep(5)
        # resolution = self.driver.execute_script('''
        #     return {
        #         x_plan : window.screen.availWidth,
        #         y_plan : window.screen.availHeight,
        #         x_fact: window.innerWidth,
        #         y_fact: window.innerHeight
        #     }
        # ''')
        # print(resolution)
        self.driver.get("https://driverpracticaltest.dvsa.gov.uk/login")
        waiting_list = [
            EC.visibility_of_element_located( (By.XPATH, '//input[@id="driving-licence-number"]') ),
            EC.visibility_of_element_located( (By.XPATH, '//section[@id="confirm-booking-details"]') )
        ]
        
        element = self.wait_with_captcha(waiting_list)
        element_id = element.get_attribute("id")
        if element_id == "driving-licence-number":
            sleep(2)
            self.auth()
        elif element_id == "confirm-booking-details":
            self.loger.info("Authorized")
        else: 
            raise Exception("Unknown element")

    
    def auth(self) -> None:
        self.custom_type( (By.XPATH, '//input[@id="driving-licence-number"]'), self.license)
        self.custom_type( (By.XPATH, '//input[@id="application-reference-number"]'), self.ref_num)
        # sleep(30000)
        # TODO form filling validation
        self.custom_click( (By.XPATH, '//input[@id="booking-login"]') )
        
        element = self.wait_with_captcha( [
            EC.visibility_of_element_located( (By.XPATH, '//section[@id="confirm-booking-details"]') ),
            EC.visibility_of_element_located( (By.XPATH, '//section[contains(@class,"error-summary")]') ),
            EC.visibility_of_element_located( (By.XPATH, '//section[contains(@class,"error-summary")]') )
        ])

        if element.get_attribute("class") is not None and "error-summary" in element.get_attribute("class"):
            raise AuthorizationFailed()
        
        if len(self.driver.find_elements(By.XPATH, '//a[@id="test-centre-change"]') ) == 0:
            raise TestCanceled()
        

    def solve_captcha(self) -> None:
        
        captcha_data = self.driver.execute_script('''
            var ua = window.navigator.userAgent
            var target = document.getElementById("main-iframe")
            target = target.contentWindow
            if(target == null){
                return {"sitekey" : sitekey, "siteurl": siteurl, "status": "no-captcha"}
            }
            var is_blocked = target.document.getElementsByClassName("error-code").length > 0
            if(is_blocked){
                return {"sitekey" : false, "siteurl": false, "ua": false, "status": "blocked"}
            }
            var siteurl = target.document.location.href
            var hcaptcha_elements = target.document.getElementsByClassName("h-captcha")
            if(hcaptcha_elements.length === 0){
                return {"sitekey" : sitekey, "siteurl": siteurl, "ua": false, "status": "no-captcha"}
            }
            var sitekey = hcaptcha_elements[0].getAttribute("data-sitekey")
            return {"sitekey" : sitekey, "siteurl": siteurl, "ua": ua, "status": "ready"}
        ''')
        if captcha_data["status"] == "blocked":
            return {"was_error": True, "status": "blocked"}
        if captcha_data["status"] == "no-captcha":
            return {"was_error": False, "status": "no-captcha"}
        self.loger.info("Captcha solving started")
        captcha_response = self.captcha_solver.solve_hcaptcha(captcha_data["siteurl"], captcha_data["sitekey"], captcha_data["ua"])
        self.loger.info("Captcha token received")
        self.driver.execute_script(f'''
            var target = document.getElementById("main-iframe")
            target = target.contentWindow
            if(target == null){{
                return
            }}
            target.onCaptchaFinished('{captcha_response}')
        ''')
        self.loger.info("Captcha token submited")
        return {"was_error": False, "status": "solved"}

    def wait_with_captcha(self,  elements_list: list) -> WebElement:
        self.loger.debug("Waiting started")
        captcha_element_ids = ["main-iframe", "interstitial-inprogress"]
        captcha_conditions_list = [
            EC.visibility_of_element_located( (By.XPATH, '//iframe[@id="main-iframe"]') ),
            EC.presence_of_element_located( (By.XPATH, '//*[@id="interstitial-inprogress"]') )
        ] + elements_list
        
        counter_ip_blocked = 0
        counter_stand_by = 0
        captcha_attempts = 0
        solving_start_time = time()
        while True:
            if time() - solving_start_time > 60:
                raise CaptchaSolverTimeoutException()
            if captcha_attempts >= self.config["captcha_solve_attempts"]:
                raise CaptchaAttemptsLimit()
            
            element = WebDriverWait(self.driver, 20).until(EC.any_of(
                *captcha_conditions_list
            ))
            element_id = element.get_attribute("id")
            if element_id not in captcha_element_ids:
                self.loger.debug("Wait is over")
                return element

            if element_id == "interstitial-inprogress":
                self.loger.info("Please stand by")
                sleep(4)
                self.driver.implicitly_wait(0)
                if len(self.driver.find_elements(By.XPATH, '//*[@id="interstitial-inprogress"]') ):
                    if counter_stand_by >= 10:
                        raise PleaseStandByException()
                    counter_stand_by += 1
                    self.driver.refresh()
                    self.loger.info("Refresh")
                    sleep(2)
                # self.driver.implicitly_wait(30)
                solving_start_time = time()
                continue
            
            if element_id == "main-iframe":
                counter_stand_by = 0
                captcha_res = self.solve_captcha()
                if captcha_res["was_error"]:
                    if counter_ip_blocked >= 1:
                        raise ImpervaIPBlocked()
                    counter_ip_blocked += 1
                    self.driver.refresh()
                    self.loger.info("Refresh")
                    sleep(2)
                    continue
                sleep(5)
                if captcha_res["status"] == "solved":
                    solving_start_time = time()
                    captcha_attempts += 1
    
    def custom_type(self, element: tuple, text: str) -> None:
        self.loger.debug("Type text")
        sleep(self.config["pause_type"])
        typing_pause = uniform(40/self.config["typing_speed"],  80/self.config["typing_speed"])
        for key in text:
            self.driver.find_element(*element).send_keys(key)
            sleep(typing_pause)
        sleep(1)
    
    def custom_click(self, element: tuple, disable_emulation=False) -> None:
        self.loger.debug("Click")
        sleep(self.config["pause_clicks"])
        if disable_emulation:
            elem = self.driver.find_element(*element)
            self.driver.execute_script("arguments[0].click();", elem)
            return
        self.driver.find_element(*element).click()

    def clear_input(self, element: tuple) -> None:
        self.loger.debug("Clear input")
        sleep(self.config["pause_type"])
        web_element = self.driver.find_element(*element)
        
        os = platform.system()
        if os == 'Darwin':
            web_element.send_keys(Keys.COMMAND, "a")
        else:
            web_element.send_keys(Keys.CONTROL, "a")
            
        # web_element.send_keys(Keys.CONTROL + "a")
        
        sleep(self.config["pause_type"])
        web_element.send_keys(Keys.BACK_SPACE)

    def ping(self):
        self.loger.debug("Ping start")
        result = self.tasks_api.ping(self.task_id)
        if "message" in result and result["message"] == "You are not authorized to ping this task":
            self.stop_browser()
            raise TaskMissedException()
        elif "message" in result and result["message"] == "Ping received":
            self.loger.debug("Ping end")
            return
        else:
            raise TaskPingUnknownAnswer()
