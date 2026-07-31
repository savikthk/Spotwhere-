#include <drogon/drogon.h>
#include <libpq-fe.h>
#include <curl/curl.h>
#include <string>
#include <vector>
#include <map>
#include <set>
#include <random>
#include <algorithm>
#include <cstdlib>
#include <cmath>
#include <ctime>
#include <mutex>
#include <thread>
#include <chrono>

static const std::string DB_CONN =
    "host=localhost port=5433 dbname=spotwhere user=spotwhere password=spotwhere_pass";
static const double PI = 3.14159265358979323846;

static std::string gigachatKey()
{
    const char *k = std::getenv("GIGACHAT_KEY");
    return k ? k : "";
}

static const std::string SYSTEM_PROMPT =
    "Ты — модуль разбора запроса сервиса, который советует, куда сходить.\n"
    "Извлеки признаки из запроса и верни СТРОГО JSON без пояснений, по схеме:\n"
    "{\n"
    "  \"mood\": \"тихо\" | \"шумно\" | \"романтика\" | \"\",\n"
    "  \"company\": \"вдвоём\" | \"компания\" | \"друзья\" | \"один\" | \"\",\n"
    "  \"category\": одно из [кафе, ресторан, бар, паб, быстро, клуб, кальянная, компьютерный клуб, кино, баня, спа, боулинг, квест, батутный центр, аквапарк, танцы, игровые автоматы] или \"\",\n"
    "  \"location\": \"район, улица, станция метро или ориентир из запроса, иначе пусто\",\n"
    "  \"precise\": true если указана конкретная точка (метро/адрес/ориентир), false для района или если места нет,\n"
    "  \"features\": массив из набора [веранда, wifi, для работы, живая музыка, крафт, веган, круглосуточно],\n"
    "  \"budget_max\": число в рублях или 1000000 если не указан\n"
    "}\n"
    "Отвечай ТОЛЬКО валидным JSON.";

static Json::Value parseJson(const std::string &s);

static Json::Value loadVenues()
{
    Json::Value venues(Json::arrayValue);
    PGconn *conn = PQconnectdb(DB_CONN.c_str());
    if (PQstatus(conn) == CONNECTION_OK)
    {
        PGresult *res = PQexec(conn,
            "SELECT id, name, description, array_to_json(tags)::text, "
            "avg_bill, lat, lon, maps_url, COALESCE(address, '') FROM venues");
        if (PQresultStatus(res) == PGRES_TUPLES_OK)
            for (int i = 0; i < PQntuples(res); ++i)
            {
                Json::Value v;
                v["id"] = std::atoi(PQgetvalue(res, i, 0));
                v["name"] = PQgetvalue(res, i, 1);
                v["description"] = PQgetvalue(res, i, 2);
                v["tags"] = parseJson(PQgetvalue(res, i, 3));
                v["avg_bill"] = std::atoi(PQgetvalue(res, i, 4));
                v["lat"] = std::atof(PQgetvalue(res, i, 5));
                v["lon"] = std::atof(PQgetvalue(res, i, 6));
                v["maps_url"] = PQgetvalue(res, i, 7);
                v["address"] = PQgetvalue(res, i, 8);
                venues.append(v);
            }
        PQclear(res);
    }
    PQfinish(conn);
    LOG_INFO << "Loaded " << venues.size() << " venues from Postgres";
    return venues;
}

static drogon::HttpResponsePtr jsonResponse(const Json::Value &data)
{
    Json::StreamWriterBuilder builder;
    builder["emitUTF8"] = true;
    auto resp = drogon::HttpResponse::newHttpResponse();
    resp->setContentTypeCode(drogon::CT_APPLICATION_JSON);
    resp->setBody(Json::writeString(builder, data));
    return resp;
}

static std::string makeUuid()
{
    static std::mt19937 rng(std::random_device{}());
    std::uniform_int_distribution<int> d(0, 15);
    const char *hex = "0123456789abcdef";
    std::string u = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx";
    for (char &c : u)
    {
        if (c == 'x') c = hex[d(rng)];
        else if (c == 'y') c = hex[(d(rng) & 0x3) | 0x8];
    }
    return u;
}

static size_t writeCb(char *ptr, size_t size, size_t nmemb, void *userdata)
{
    static_cast<std::string *>(userdata)->append(ptr, size * nmemb);
    return size * nmemb;
}

static std::string httpPost(const std::string &url, const std::string &body,
                            const std::vector<std::string> &headers)
{
    CURL *curl = curl_easy_init();
    std::string resp;
    struct curl_slist *hdrs = nullptr;
    for (const auto &h : headers)
        hdrs = curl_slist_append(hdrs, h.c_str());
    curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
    curl_easy_setopt(curl, CURLOPT_POSTFIELDS, body.c_str());
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, hdrs);
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, writeCb);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &resp);
    curl_easy_setopt(curl, CURLOPT_SSL_VERIFYPEER, 0L);
    curl_easy_setopt(curl, CURLOPT_SSL_VERIFYHOST, 0L);
    curl_easy_perform(curl);
    curl_slist_free_all(hdrs);
    curl_easy_cleanup(curl);
    return resp;
}

static std::string httpGet(const std::string &url)
{
    CURL *curl = curl_easy_init();
    std::string resp;
    struct curl_slist *hdrs = curl_slist_append(nullptr, "User-Agent: spotwhere/1.0");
    curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, hdrs);
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, writeCb);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &resp);
    curl_easy_setopt(curl, CURLOPT_FOLLOWLOCATION, 1L);
    curl_easy_setopt(curl, CURLOPT_SSL_VERIFYPEER, 0L);
    curl_easy_setopt(curl, CURLOPT_SSL_VERIFYHOST, 0L);
    curl_easy_setopt(curl, CURLOPT_TIMEOUT, 20L);
    curl_easy_perform(curl);
    curl_slist_free_all(hdrs);
    curl_easy_cleanup(curl);
    return resp;
}

static Json::Value parseJson(const std::string &s)
{
    Json::Value v;
    Json::CharReaderBuilder b;
    std::string err;
    std::unique_ptr<Json::CharReader> reader(b.newCharReader());
    reader->parse(s.c_str(), s.c_str() + s.size(), &v, &err);
    return v;
}

static bool geocode(const std::string &place, double &lat, double &lon)
{
    static std::map<std::string, std::pair<double, double>> cache;
    static std::mutex mtx;
    {
        std::lock_guard<std::mutex> lk(mtx);
        auto it = cache.find(place);
        if (it != cache.end())
        {
            lat = it->second.first;
            lon = it->second.second;
            return true;
        }
    }

    CURL *c = curl_easy_init();
    std::string query = place + ", Москва";
    char *esc = curl_easy_escape(c, query.c_str(), 0);
    std::string url = "https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" + std::string(esc);
    curl_free(esc);
    curl_easy_cleanup(c);

    for (int attempt = 0; attempt < 3; ++attempt)
    {
        Json::Value arr = parseJson(httpGet(url));
        if (arr.isArray() && !arr.empty())
        {
            lat = std::atof(arr[0]["lat"].asString().c_str());
            lon = std::atof(arr[0]["lon"].asString().c_str());
            std::lock_guard<std::mutex> lk(mtx);
            cache[place] = {lat, lon};
            return true;
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(700));
    }
    return false;
}

static double haversineKm(double lat1, double lon1, double lat2, double lon2)
{
    double dLat = (lat2 - lat1) * PI / 180.0;
    double dLon = (lon2 - lon1) * PI / 180.0;
    double a = std::sin(dLat / 2) * std::sin(dLat / 2) +
               std::cos(lat1 * PI / 180.0) * std::cos(lat2 * PI / 180.0) *
               std::sin(dLon / 2) * std::sin(dLon / 2);
    return 6371.0 * 2 * std::atan2(std::sqrt(a), std::sqrt(1 - a));
}

static std::string gigaToken()
{
    static std::string cached;
    static time_t expiry = 0;
    if (!cached.empty() && time(nullptr) < expiry)
        return cached;

    std::vector<std::string> headers = {
        "Content-Type: application/x-www-form-urlencoded",
        "Accept: application/json",
        "RqUID: " + makeUuid(),
        "Authorization: Basic " + gigachatKey(),
    };
    std::string resp = httpPost(
        "https://ngw.devices.sberbank.ru:9443/api/v2/oauth",
        "scope=GIGACHAT_API_PERS", headers);
    cached = parseJson(resp)["access_token"].asString();
    expiry = time(nullptr) + 1500;
    return cached;
}

static Json::Value parseText(const std::string &text)
{
    Json::Value f;
    f["mood"] = "";
    f["company"] = "";
    f["category"] = "";
    f["location"] = "";
    f["precise"] = false;
    f["features"] = Json::Value(Json::arrayValue);
    f["budget_max"] = 1000000;

    std::string token = gigaToken();
    if (token.empty())
        return f;

    Json::Value payload;
    payload["model"] = "GigaChat";
    Json::Value sys, usr;
    sys["role"] = "system"; sys["content"] = SYSTEM_PROMPT;
    usr["role"] = "user"; usr["content"] = text;
    payload["messages"].append(sys);
    payload["messages"].append(usr);
    payload["temperature"] = 0.1;

    Json::StreamWriterBuilder wb;
    std::string resp = httpPost(
        "https://gigachat.devices.sberbank.ru/api/v1/chat/completions",
        Json::writeString(wb, payload),
        {"Content-Type: application/json", "Accept: application/json",
         "Authorization: Bearer " + token});

    std::string content =
        parseJson(resp)["choices"][0]["message"]["content"].asString();
    auto s = content.find('{'), e = content.rfind('}');
    if (s == std::string::npos || e == std::string::npos)
        return f;

    Json::Value data = parseJson(content.substr(s, e - s + 1));
    f["mood"] = data.get("mood", "").asString();
    f["company"] = data.get("company", "").asString();
    f["category"] = data.get("category", "").asString();
    f["location"] = data.get("location", "").asString();
    f["precise"] = data.get("precise", false).asBool();
    if (data.isMember("features") && data["features"].isArray())
        f["features"] = data["features"];
    if (data.isMember("budget_max") && data["budget_max"].isInt())
        f["budget_max"] = data["budget_max"].asInt();
    return f;
}

static Json::Value aiRerank(const std::string &text, const Json::Value &shortlist)
{
    Json::Value out(Json::arrayValue);
    if (shortlist.empty())
        return out;

    std::string token = gigaToken();
    if (token.empty())
        return out;

    std::string listing;
    for (const auto &v : shortlist)
    {
        listing += std::to_string(v["id"].asInt()) + ". " + v["name"].asString() +
                   " — " + v["description"].asString() + " — теги:";
        for (const auto &t : v["tags"])
            listing += " " + t.asString();
        listing += " — ~" + std::to_string(v["avg_bill"].asInt()) + " руб\n";
    }

    std::string prompt =
        "Пользователь ищет: \"" + text + "\".\n"
        "Кандидаты:\n" + listing +
        "Выбери до 5 самых подходящих под запрос (лучшие первыми). Верни СТРОГО "
        "JSON-массив id без пояснений, например: [12, 7, 3]";

    Json::Value payload;
    payload["model"] = "GigaChat";
    Json::Value msg;
    msg["role"] = "user";
    msg["content"] = prompt;
    payload["messages"].append(msg);
    payload["temperature"] = 0.2;

    Json::StreamWriterBuilder wb;
    std::string resp = httpPost(
        "https://gigachat.devices.sberbank.ru/api/v1/chat/completions",
        Json::writeString(wb, payload),
        {"Content-Type: application/json", "Accept: application/json",
         "Authorization: Bearer " + token});

    std::string content =
        parseJson(resp)["choices"][0]["message"]["content"].asString();
    auto s = content.find('['), e = content.rfind(']');
    if (s == std::string::npos || e == std::string::npos)
        return out;

    Json::Value picks = parseJson(content.substr(s, e - s + 1));
    if (!picks.isArray())
        return out;

    for (const auto &p : picks)
    {
        int id = p.isObject() ? p["id"].asInt() : p.asInt();
        for (const auto &v : shortlist)
            if (v["id"].asInt() == id)
            {
                out.append(v);
                break;
            }
        if (out.size() >= 5)
            break;
    }
    return out;
}

static std::map<std::string, double> getWeights(long userId)
{
    std::map<std::string, double> weights;
    PGconn *conn = PQconnectdb(DB_CONN.c_str());
    if (PQstatus(conn) == CONNECTION_OK)
    {
        std::string uid = std::to_string(userId);
        const char *params[1] = {uid.c_str()};
        PGresult *res = PQexecParams(
            conn, "SELECT tag, weight FROM user_tag_weights WHERE user_id = $1",
            1, nullptr, params, nullptr, nullptr, 0);
        if (PQresultStatus(res) == PGRES_TUPLES_OK)
            for (int i = 0; i < PQntuples(res); ++i)
                weights[PQgetvalue(res, i, 0)] = std::atof(PQgetvalue(res, i, 1));
        PQclear(res);
    }
    PQfinish(conn);
    return weights;
}

static void saveWeight(long userId, const std::string &tag, double delta)
{
    PGconn *conn = PQconnectdb(DB_CONN.c_str());
    if (PQstatus(conn) == CONNECTION_OK)
    {
        std::string uid = std::to_string(userId);
        const char *sel[2] = {uid.c_str(), tag.c_str()};
        PGresult *res = PQexecParams(
            conn, "SELECT weight FROM user_tag_weights WHERE user_id = $1 AND tag = $2",
            2, nullptr, sel, nullptr, nullptr, 0);
        bool exists = PQresultStatus(res) == PGRES_TUPLES_OK && PQntuples(res) > 0;
        double current = exists ? std::atof(PQgetvalue(res, 0, 0)) : 0.0;
        PQclear(res);
        if (exists)
        {
            std::string w = std::to_string(current + delta);
            const char *p[3] = {w.c_str(), uid.c_str(), tag.c_str()};
            PQclear(PQexecParams(conn,
                "UPDATE user_tag_weights SET weight = $1 WHERE user_id = $2 AND tag = $3",
                3, nullptr, p, nullptr, nullptr, 0));
        }
        else
        {
            std::string w = std::to_string(delta);
            const char *p[3] = {uid.c_str(), tag.c_str(), w.c_str()};
            PQclear(PQexecParams(conn,
                "INSERT INTO user_tag_weights (user_id, tag, weight) VALUES ($1, $2, $3)",
                3, nullptr, p, nullptr, nullptr, 0));
        }
    }
    PQfinish(conn);
}

static bool hasTag(const Json::Value &venue, const std::string &value)
{
    if (value.empty())
        return false;
    for (const auto &tag : venue["tags"])
        if (tag.asString() == value)
            return true;
    return false;
}

static bool knownCategory(const std::string &c)
{
    return c == "кафе" || c == "ресторан" || c == "бар" || c == "паб" || c == "быстро" ||
           c == "клуб" || c == "кальянная" || c == "компьютерный клуб" || c == "кино" ||
           c == "баня" || c == "спа" || c == "боулинг" || c == "квест" ||
           c == "батутный центр" || c == "аквапарк" || c == "танцы" || c == "игровые автоматы";
}

static Json::Value rankVenues(const Json::Value &venues, const Json::Value &f,
                              const std::map<std::string, double> &weights,
                              bool hasGeo, double geoLat, double geoLon, double radiusKm)
{
    std::string mood = f["mood"].asString();
    std::string company = f["company"].asString();
    std::string category = f["category"].asString();
    int budgetMax = f["budget_max"].asInt();
    std::vector<std::string> feats;
    for (const auto &x : f["features"])
        feats.push_back(x.asString());

    bool hardFilter = !category.empty() || hasGeo || budgetMax < 1000000;

    std::vector<std::pair<double, Json::Value>> scored;
    for (const auto &venue : venues)
    {
        if (venue["avg_bill"].asInt() > budgetMax)
            continue;
        if (!category.empty() && !hasTag(venue, category))
            continue;
        if (hasGeo)
        {
            double d = haversineKm(geoLat, geoLon, venue["lat"].asDouble(), venue["lon"].asDouble());
            if (d > radiusKm)
                continue;
        }

        double score = 0;
        if (hasTag(venue, mood)) score += 1;
        if (hasTag(venue, company)) score += 1;
        for (const auto &ft : feats)
            if (hasTag(venue, ft)) score += 1;
        for (const auto &tag : venue["tags"])
        {
            auto it = weights.find(tag.asString());
            if (it != weights.end())
                score += it->second;
        }
        if (score > 0 || hardFilter)
            scored.push_back({score, venue});
    }
    std::sort(scored.begin(), scored.end(),
              [](const auto &a, const auto &b) { return a.first > b.first; });

    Json::Value results(Json::arrayValue);
    std::set<std::string> seen;
    for (const auto &[score, venue] : scored)
    {
        std::string name = venue["name"].asString();
        if (seen.count(name))
            continue;
        seen.insert(name);
        results.append(venue);
        if (results.size() >= 15)
            break;
    }
    return results;
}

int main()
{
    curl_global_init(CURL_GLOBAL_DEFAULT);
    const Json::Value venues = loadVenues();

    drogon::app().registerPreRoutingAdvice(
        [](const drogon::HttpRequestPtr &req, drogon::AdviceCallback &&stop,
           drogon::AdviceChainCallback &&next)
        {
            if (req->method() == drogon::Options)
            {
                auto resp = drogon::HttpResponse::newHttpResponse();
                resp->addHeader("Access-Control-Allow-Origin", "*");
                resp->addHeader("Access-Control-Allow-Methods", "*");
                resp->addHeader("Access-Control-Allow-Headers", "*");
                stop(resp);
            }
            else
                next();
        });
    drogon::app().registerPostHandlingAdvice(
        [](const drogon::HttpRequestPtr &, const drogon::HttpResponsePtr &resp)
        {
            resp->addHeader("Access-Control-Allow-Origin", "*");
        });

    drogon::app().registerHandler(
        "/health",
        [](const drogon::HttpRequestPtr &,
           std::function<void(const drogon::HttpResponsePtr &)> &&callback)
        {
            Json::Value json;
            json["status"] = "ok";
            json["service"] = "spotwhere";
            callback(jsonResponse(json));
        },
        {drogon::Get});

    drogon::app().registerHandler(
        "/venues",
        [venues](const drogon::HttpRequestPtr &,
                 std::function<void(const drogon::HttpResponsePtr &)> &&callback)
        {
            callback(jsonResponse(venues));
        },
        {drogon::Get});

    drogon::app().registerHandler(
        "/recommend",
        [venues](const drogon::HttpRequestPtr &req,
                 std::function<void(const drogon::HttpResponsePtr &)> &&callback)
        {
            auto body = req->getJsonObject();
            std::string text = body ? (*body)["text"].asString() : "";
            long userId = (body && body->isMember("user_id"))
                              ? (*body)["user_id"].asLargestInt() : 0;

            Json::Value f = parseText(text);

            if (!knownCategory(f["category"].asString()))
                f["category"] = "";

            bool hasGeo = false;
            double geoLat = 0, geoLon = 0, radiusKm = 2.0;
            std::string loc = f["location"].asString();
            if (!loc.empty())
            {
                hasGeo = geocode(loc, geoLat, geoLon);
                bool precise = f["precise"].asBool() ||
                               loc.find("метро") != std::string::npos ||
                               loc.find("Метро") != std::string::npos;
                radiusKm = precise ? 0.8 : 2.0;
            }

            auto weights = getWeights(userId);

            Json::Value shortlist = rankVenues(venues, f, weights, hasGeo, geoLat, geoLon, radiusKm);
            if (shortlist.empty() && !f["category"].asString().empty())
            {
                Json::Value relaxed = f;
                relaxed["category"] = "";
                shortlist = rankVenues(venues, relaxed, weights, hasGeo, geoLat, geoLon, radiusKm);
            }
            for (double r = radiusKm + 1.5; shortlist.empty() && hasGeo && r <= 5.0; r += 1.5)
                shortlist = rankVenues(venues, f, weights, true, geoLat, geoLon, r);

            Json::Value results = aiRerank(text, shortlist);
            if (results.empty())
                for (Json::ArrayIndex i = 0; i < shortlist.size() && i < 5; ++i)
                    results.append(shortlist[i]);

            Json::Value out;
            out["query"] = f;
            out["results"] = results;
            callback(jsonResponse(out));
        },
        {drogon::Post});

    drogon::app().registerHandler(
        "/like",
        [venues](const drogon::HttpRequestPtr &req,
                 std::function<void(const drogon::HttpResponsePtr &)> &&callback)
        {
            auto body = req->getJsonObject();
            long userId = (body && body->isMember("user_id"))
                              ? (*body)["user_id"].asLargestInt() : 0;
            int venueId = (body && body->isMember("venue_id"))
                              ? (*body)["venue_id"].asInt() : 0;
            for (const auto &venue : venues)
                if (venue["id"].asInt() == venueId)
                {
                    for (const auto &tag : venue["tags"])
                        saveWeight(userId, tag.asString(), 0.2);
                    break;
                }
            Json::Value out;
            out["status"] = "ok";
            callback(jsonResponse(out));
        },
        {drogon::Post});

    drogon::app().registerHandler(
        "/dislike",
        [venues](const drogon::HttpRequestPtr &req,
                 std::function<void(const drogon::HttpResponsePtr &)> &&callback)
        {
            auto body = req->getJsonObject();
            long userId = (body && body->isMember("user_id"))
                              ? (*body)["user_id"].asLargestInt() : 0;
            int venueId = (body && body->isMember("venue_id"))
                              ? (*body)["venue_id"].asInt() : 0;
            for (const auto &venue : venues)
                if (venue["id"].asInt() == venueId)
                {
                    for (const auto &tag : venue["tags"])
                        saveWeight(userId, tag.asString(), -0.1);
                    break;
                }
            Json::Value out;
            out["status"] = "ok";
            callback(jsonResponse(out));
        },
        {drogon::Post});

    drogon::app().setDocumentRoot("../frontend");

    LOG_INFO << "Spotwhere backend on http://127.0.0.1:8080";
    drogon::app().addListener("127.0.0.1", 8080).run();
    return 0;
}
